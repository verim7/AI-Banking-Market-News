import { describe, expect, it } from 'vitest';
import {
  API_RULE, LOGIN_RULE, clientKey, consume, reset, rulesFor,
} from '../src/rate-limit.ts';
import type { Env } from '../src/types.ts';

/**
 * A stand-in for D1 that implements exactly the one statement the limiter
 * uses. Mocking the database rather than the limiter is the point: the
 * atomicity argument in rate-limit.ts lives in that SQL, so a test that stubbed
 * `consume` itself would prove nothing about it.
 */
function fakeDb() {
  const rows = new Map<string, { count: number; window_start: string }>();
  return {
    rows,
    prepare(sql: string) {
      let bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) { bound = args; return api; },
        async first<T>(): Promise<T | null> {
          if (sql.includes('INSERT INTO rate_limits')) {
            const [key, start] = bound as [string, string];
            const existing = rows.get(key);
            if (!existing || existing.window_start < start) {
              rows.set(key, { count: 1, window_start: start });
            } else {
              existing.count += 1;
            }
            return { count: rows.get(key)!.count } as T;
          }
          return null;
        },
        async run() {
          if (sql.startsWith('DELETE FROM rate_limits WHERE key')) {
            rows.delete((bound as [string])[0]);
          }
          return { success: true };
        },
      };
      return api;
    },
  };
}

const envWith = (db: ReturnType<typeof fakeDb>) => ({ DB: db } as unknown as Env);

describe('counting requests against a key', () => {
  it('allows exactly the limit and refuses the next one', async () => {
    const db = fakeDb();
    const env = envWith(db);
    const rule = { limit: 3, windowSeconds: 60 };
    const now = new Date('2026-09-18T10:00:00Z');

    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consume(env, 'k', rule, now));

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.count)).toEqual([1, 2, 3, 4]);
  });

  it('starts over once the window has elapsed', async () => {
    const db = fakeDb();
    const env = envWith(db);
    const rule = { limit: 1, windowSeconds: 60 };

    expect((await consume(env, 'k', rule, new Date('2026-09-18T10:00:30Z'))).allowed).toBe(true);
    expect((await consume(env, 'k', rule, new Date('2026-09-18T10:00:45Z'))).allowed).toBe(false);
    // Next minute: a new window, so the counter resets.
    expect((await consume(env, 'k', rule, new Date('2026-09-18T10:01:05Z'))).allowed).toBe(true);
  });

  it('counts each key separately', async () => {
    const db = fakeDb();
    const env = envWith(db);
    const rule = { limit: 1, windowSeconds: 60 };
    const now = new Date('2026-09-18T10:00:00Z');

    expect((await consume(env, 'a', rule, now)).allowed).toBe(true);
    // Someone else's exhausted bucket must not spend this one.
    expect((await consume(env, 'b', rule, now)).allowed).toBe(true);
    expect((await consume(env, 'a', rule, now)).allowed).toBe(false);
  });

  it('says how long to wait, and never says zero', async () => {
    const db = fakeDb();
    const env = envWith(db);
    const rule = { limit: 1, windowSeconds: 60 };

    const early = await consume(env, 'k', rule, new Date('2026-09-18T10:00:00Z'));
    expect(early.retryAfter).toBe(60);

    // A request in the last moment of a window would compute 0 seconds, and a
    // `Retry-After: 0` invites an immediate retry that is refused again.
    const late = await consume(env, 'k2', rule, new Date('2026-09-18T10:00:59.900Z'));
    expect(late.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it('forgets a key when it is reset', async () => {
    const db = fakeDb();
    const env = envWith(db);
    const rule = { limit: 1, windowSeconds: 60 };
    const now = new Date('2026-09-18T10:00:00Z');

    await consume(env, 'k', rule, now);
    expect((await consume(env, 'k', rule, now)).allowed).toBe(false);

    // What a successful sign-in does, so four typos then the right password
    // does not leave someone one attempt from a lockout.
    await reset(env, 'k');
    expect((await consume(env, 'k', rule, now)).allowed).toBe(true);
  });
});

describe('which address the limit is keyed on', () => {
  it('trusts the header Cloudflare sets, not the one a client can forge', () => {
    // X-Forwarded-For is attacker-controlled: a limiter keyed on it is
    // bypassed by sending a different value on every request. Cloudflare
    // overwrites CF-Connecting-IP at the edge, so that one is worth believing.
    const req = new Request('https://example.com', {
      headers: { 'CF-Connecting-IP': '203.0.113.7', 'X-Forwarded-For': '1.2.3.4' },
    });
    expect(clientKey(req)).toBe('203.0.113.7');
  });

  it('falls back to one shared bucket rather than to no limit', () => {
    // Local dev and tests have no CF header. Everyone sharing a bucket is
    // strict; failing towards "limited" is the right direction for this.
    expect(clientKey(new Request('https://example.com'))).toBe('unknown');
  });
});

describe('the rules themselves', () => {
  it('keeps login far stricter than the rest of the API', () => {
    // The asymmetry is deliberate and is the whole reason this file exists: a
    // login request runs 100,000 PBKDF2 iterations even for an unknown email,
    // so it is orders of magnitude more expensive than any other endpoint.
    const loginPerHour = LOGIN_RULE.limit * (3600 / LOGIN_RULE.windowSeconds);
    const apiPerHour = API_RULE.limit * (3600 / API_RULE.windowSeconds);
    expect(loginPerHour).toBeLessThan(apiPerHour / 100);
  });

  it('leaves room for ordinary use of the app', () => {
    // Clicking through filters makes tens of requests a minute. A ceiling that
    // a real session hits is a ceiling someone will remove.
    expect(API_RULE.limit).toBeGreaterThanOrEqual(120);
    expect(LOGIN_RULE.limit).toBeGreaterThanOrEqual(3);
  });
});

describe('raising the ceiling for a test environment', () => {
  const env = (over: Record<string, string>) => over as unknown as Env;

  it('uses the production values when nothing is set', () => {
    const { login, api } = rulesFor(env({}));
    expect(login).toEqual(LOGIN_RULE);
    expect(api).toEqual(API_RULE);
  });

  it('lets a dev environment raise them', () => {
    // Why this exists: every e2e test signs in, and forty-six sign-ins from one
    // address inside a minute is exactly what LOGIN_RULE refuses. The suite
    // failed a different handful of tests each run and read as flakiness for
    // two days.
    const { login, api } = rulesFor(env({ RATE_LIMIT_LOGIN: '500', RATE_LIMIT_API: '20000' }));
    expect(login.limit).toBe(500);
    expect(api.limit).toBe(20_000);
    // The window is not negotiable, only the count.
    expect(login.windowSeconds).toBe(LOGIN_RULE.windowSeconds);
  });

  it('never lowers a limit, and never accepts nonsense', () => {
    // A typo in a local file must not be able to weaken a production control,
    // and these variables could one day be set somewhere they should not be.
    for (const bad of ['1', '0', '-5', 'abc', '', 'Infinity', '999999999']) {
      expect(rulesFor(env({ RATE_LIMIT_LOGIN: bad })).login).toEqual(LOGIN_RULE);
    }
  });
});
