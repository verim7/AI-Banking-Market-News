/**
 * Rate limiting, and why the login route needs it more than most.
 *
 * Until this existed there was no limit anywhere in the app: no cap on login
 * attempts, no lockout, no counting of failures. For a private tool that reads
 * as a small omission. It is not, and the reason is specific to how this login
 * is built.
 *
 * `routes/auth.ts` deliberately runs the full PBKDF2 — 100,000 iterations —
 * even when the email does not exist, hashing against a dummy salt so the
 * response time cannot be used to enumerate accounts. That is the right call
 * for privacy. Its cost is that **every junk request is as expensive as a real
 * one**: an attacker does not need to guess a valid address to make the Worker
 * do the work. On Cloudflare's free plan, with roughly 10 ms of CPU per
 * request, a loop of `POST /api/auth/login` is simultaneously a password
 * guessing attack and a way to exhaust the CPU budget for everyone else.
 *
 * So the ordering below is the entire point: **the limit is checked before the
 * hash is computed**. A refused request costs one indexed read and one write
 * instead of 100,000 iterations of SHA-256. A limiter placed after the hash
 * would stop the guessing and do nothing at all about the exhaustion.
 */

import type { Env } from './types.ts';

export interface RateLimitResult {
  allowed: boolean;
  /** Requests used in the current window, including this one. */
  count: number;
  /** Seconds until the window resets. Sent as `Retry-After` when refused. */
  retryAfter: number;
}

export interface RateLimitRule {
  /** How many requests the window allows. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Login is the strict one: five attempts per window.
 *
 * Fifteen minutes is long enough to make guessing pointless and short enough
 * that someone who genuinely forgot their password is not locked out for the
 * afternoon. Five is above any realistic number of honest typos.
 */
export const LOGIN_RULE: RateLimitRule = { limit: 5, windowSeconds: 15 * 60 };

/**
 * The same rules, with an environment allowed to raise the ceiling.
 *
 * Added because the limiter was silently failing the end-to-end suite. Every
 * test signs in, and forty-six sign-ins from one address in a minute is
 * exactly what LOGIN_RULE exists to refuse — so the worker answered 429, a
 * different handful of tests failed on each run, and it read as flakiness on a
 * slow machine for two days. It was the limiter doing its job to a client that
 * was not an attacker.
 *
 * Production sets neither variable and gets the values above. A dev or test
 * environment sets them in `.dev.vars`, which is gitignored and never shipped.
 * The alternative — turning the limiter off for tests — would mean the one
 * environment that runs every route never exercises the middleware at all.
 *
 * A malformed or absurd value is ignored rather than honoured: a typo in a
 * local file must not be able to disable a production control, in case these
 * ever get set somewhere they should not be.
 */
export function rulesFor(env: Env): { login: RateLimitRule; api: RateLimitRule } {
  const override = (raw: unknown, fallback: RateLimitRule): RateLimitRule => {
    const n = Number(raw);
    return Number.isFinite(n) && n > fallback.limit && n <= 100_000
      ? { ...fallback, limit: n }
      : fallback;
  };
  const e = env as unknown as { RATE_LIMIT_LOGIN?: string; RATE_LIMIT_API?: string };
  return {
    login: override(e.RATE_LIMIT_LOGIN, LOGIN_RULE),
    api: override(e.RATE_LIMIT_API, API_RULE),
  };
}

/**
 * Everything else gets a ceiling rather than a policy. This is not meant to
 * shape normal use — a person clicking through filters can easily make thirty
 * requests in a minute — only to stop a runaway client or a scraper.
 */
export const API_RULE: RateLimitRule = { limit: 300, windowSeconds: 60 };

/**
 * The client's address, as Cloudflare reports it.
 *
 * `CF-Connecting-IP` is set by Cloudflare's edge and cannot be spoofed by the
 * client, because Cloudflare overwrites whatever arrived. `X-Forwarded-For`
 * would be the wrong choice here for exactly the opposite reason: a caller
 * controls it, so a limiter keyed on it can be bypassed by sending a different
 * value every time.
 *
 * When the header is absent — local `wrangler dev`, or a test — everything
 * shares one bucket, which is strict rather than permissive. Failing towards
 * "limited" is the correct direction for a control like this.
 */
export function clientKey(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? 'unknown';
}

/**
 * Count one request against `key` and say whether it is allowed.
 *
 * One statement, not a read followed by a write. Two statements can interleave
 * between concurrent requests — both read "4 used", both write 5, and six get
 * through a limit of five. `ON CONFLICT ... RETURNING` makes the read, the
 * decision and the write a single atomic operation, which is what makes a
 * burst of parallel requests behave.
 */
export async function consume(
  env: Env, key: string, rule: RateLimitRule, now = new Date(),
): Promise<RateLimitResult> {
  const windowMs = rule.windowSeconds * 1000;
  // Fixed windows, aligned to the epoch, so every isolate agrees on where the
  // current window starts without having to coordinate.
  const startMs = Math.floor(now.getTime() / windowMs) * windowMs;
  const start = new Date(startMs).toISOString();

  const row = await env.DB
    .prepare(
      `INSERT INTO rate_limits (key, count, window_start)
            VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
            count        = CASE WHEN rate_limits.window_start < ?2 THEN 1
                                ELSE rate_limits.count + 1 END,
            window_start = CASE WHEN rate_limits.window_start < ?2 THEN ?2
                                ELSE rate_limits.window_start END
       RETURNING count`)
    .bind(key, start)
    .first<{ count: number }>();

  const count = row?.count ?? 1;
  const retryAfter = Math.max(1, Math.ceil((startMs + windowMs - now.getTime()) / 1000));

  return { allowed: count <= rule.limit, count, retryAfter };
}

/**
 * Forget a key's counter.
 *
 * Called after a *successful* login, so that someone who mistyped their
 * password four times and then got it right is not left one attempt from a
 * lockout. Only success clears it: a failure that cleared the counter would
 * make the limit meaningless.
 */
export async function reset(env: Env, key: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM rate_limits WHERE key = ?`).bind(key).run();
}

/**
 * Drop rows whose window closed long ago.
 *
 * Without this the table grows by one row per distinct address forever. It is
 * called opportunistically — on a small fraction of requests — rather than on a
 * schedule, because a Cron trigger for a table this small is more machinery
 * than the problem deserves.
 */
export async function sweep(env: Env, olderThan: Date): Promise<void> {
  await env.DB
    .prepare(`DELETE FROM rate_limits WHERE window_start < ?`)
    .bind(olderThan.toISOString())
    .run();
}
