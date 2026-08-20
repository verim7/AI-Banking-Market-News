import { describe, expect, it } from 'vitest';
import {
  buildCookie, hashPassword, makeSessionCookieValue, readSessionCookieValue,
  timingSafeEqual, verifyPassword,
} from '../src/auth.ts';

const SECRET = 'test-secret-value';

describe('password hashing', () => {
  it('accepts the correct password', async () => {
    const { hash, salt } = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash, salt)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const { hash, salt } = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('Correct horse battery staple', hash, salt)).toBe(false);
  });

  it('salts, so the same password hashes differently for two users', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('is deterministic for a given salt', async () => {
    const a = await hashPassword('pw', 'a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4');
    const b = await hashPassword('pw', 'a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4');
    expect(a.hash).toBe(b.hash);
  });
});

describe('timingSafeEqual', () => {
  it('compares equal and unequal values correctly', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('session cookies', () => {
  it('round-trips a signed session id', async () => {
    const value = await makeSessionCookieValue('session-123', SECRET);
    expect(await readSessionCookieValue(value, SECRET)).toBe('session-123');
  });

  it('rejects a tampered session id', async () => {
    const value = await makeSessionCookieValue('session-123', SECRET);
    const forged = value.replace('session-123', 'session-999');
    expect(await readSessionCookieValue(forged, SECRET)).toBeNull();
  });

  it('rejects a cookie signed with a different secret', async () => {
    const value = await makeSessionCookieValue('session-123', 'other-secret');
    expect(await readSessionCookieValue(value, SECRET)).toBeNull();
  });

  it('rejects an unsigned session id', async () => {
    expect(await readSessionCookieValue('session-123', SECRET)).toBeNull();
  });

  it('sets HttpOnly, Secure and SameSite=Strict', () => {
    const cookie = buildCookie('v', 3600);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
  });
});
