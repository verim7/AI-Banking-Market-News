/**
 * Password hashing and sessions, built on WebCrypto because Workers has no
 * Node crypto and no native modules.
 *
 * PBKDF2-SHA256, capped by the platform rather than chosen freely.
 *
 * OWASP's 2023 floor for PBKDF2-HMAC-SHA256 is 210,000 iterations, and that is
 * what this used. Cloudflare rejects it:
 *
 *   NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
 *   supported (requested 210000).
 *
 * The cap is enforced in production but NOT by workerd locally, so this passed
 * every local test and every e2e run, then threw on the deployed Worker inside
 * verifyPassword — before any credential comparison, which made every sign-in
 * fail identically regardless of the password. WORKERS_PBKDF2_MAX exists so
 * the ceiling is named rather than remembered, and a test asserts we stay
 * under it.
 *
 * Argon2id would be preferable but has no WebCrypto implementation, and
 * shipping a WASM Argon2 into a 3 MiB Worker budget to protect six internal
 * accounts is the wrong trade. At 100,000 iterations with the 12-character
 * minimum the account script enforces, this is adequate for a private
 * deployment; it is not what I would ship for public signups.
 */

/** Hard platform limit: Cloudflare Workers rejects anything above this. */
export const WORKERS_PBKDF2_MAX = 100_000;

const ITERATIONS = WORKERS_PBKDF2_MAX;

/** Exported so a test can assert the effective count obeys the platform cap. */
export const ITERATIONS_FOR_TEST = ITERATIONS;
const KEY_LENGTH = 32;
const SESSION_TTL_DAYS = 14;

const enc = new TextEncoder();

const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Explicitly ArrayBuffer-backed: WebCrypto's BufferSource excludes SharedArrayBuffer. */
const fromHex = (hex: string): Uint8Array<ArrayBuffer> => {
  const pairs = hex.match(/.{1,2}/g) ?? [];
  const out = new Uint8Array(new ArrayBuffer(pairs.length));
  pairs.forEach((b, i) => { out[i] = parseInt(b, 16); });
  return out;
};

export function randomHex(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(
  password: string, saltHex?: string,
): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ?? randomHex(16);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    key, KEY_LENGTH * 8,
  );
  return { hash: toHex(bits), salt };
}

/** Constant-time comparison: a length-independent early return leaks the hash. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(
  password: string, expectedHash: string, salt: string,
): Promise<boolean> {
  const { hash } = await hashPassword(password, salt);
  return timingSafeEqual(hash, expectedHash);
}

/* --------------------------------------------------------------- sessions */

export interface SessionCookieParts {
  sessionId: string;
  signature: string;
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}

export async function makeSessionCookieValue(sessionId: string, secret: string): Promise<string> {
  return `${sessionId}.${await sign(sessionId, secret)}`;
}

/**
 * The signature means a stolen or guessed session id is not enough on its own;
 * an unsigned id would let anyone with a table scan mint a cookie.
 */
export async function readSessionCookieValue(
  cookieValue: string, secret: string,
): Promise<string | null> {
  const idx = cookieValue.lastIndexOf('.');
  if (idx <= 0) return null;
  const sessionId = cookieValue.slice(0, idx);
  const signature = cookieValue.slice(idx + 1);
  const expected = await sign(sessionId, secret);
  return timingSafeEqual(signature, expected) ? sessionId : null;
}

export const SESSION_COOKIE = 'portal_session';

export function sessionExpiry(now = new Date()): string {
  return new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000).toISOString();
}

export function buildCookie(value: string, maxAgeSeconds: number): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

export const SESSION_MAX_AGE = SESSION_TTL_DAYS * 86_400;
