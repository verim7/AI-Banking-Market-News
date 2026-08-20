import { describe, expect, it } from 'vitest';
import { isRateLimited, nextGap } from '../src/fetch-gdelt.ts';

describe('recognising GDELT pushback', () => {
  it('treats 429 and 403 alike', () => {
    // 403 was the majority failure in the first three-year backfill, and the
    // retry only covered 429 — so most refusals were never retried at all.
    expect(isRateLimited(new Error('HTTP 429 Too Many Requests'))).toBe(true);
    expect(isRateLimited(new Error('HTTP 403 Forbidden'))).toBe(true);
  });

  it('does not retry failures a wait cannot fix', () => {
    expect(isRateLimited(new Error('HTTP 404 Not Found'))).toBe(false);
    expect(isRateLimited(new Error('GDELT returned non-JSON (<html>)'))).toBe(false);
  });
});

describe('adaptive spacing', () => {
  it('widens on pushback', () => {
    expect(nextGap(5_000, true, 0)).toBeGreaterThan(5_000);
  });

  it('never exceeds the ceiling, however much pushback there is', () => {
    let gap = 5_000;
    for (let i = 0; i < 50; i++) gap = nextGap(gap, true, 0);
    expect(gap).toBe(30_000);
  });

  it('holds steady until a run of clean responses', () => {
    expect(nextGap(12_000, false, 1)).toBe(12_000);
    expect(nextGap(12_000, false, 4)).toBe(12_000);
    expect(nextGap(12_000, false, 5)).toBeLessThan(12_000);
  });

  it('never drops below the floor', () => {
    let gap = 12_000;
    for (let i = 0; i < 50; i++) gap = nextGap(gap, false, 10);
    expect(gap).toBe(5_000);
  });

  it('recovers more slowly than it backs off, so one bad patch does not stick', () => {
    const widened = nextGap(5_000, true, 0) - 5_000;
    const recovered = 5_000 - nextGap(5_000 + widened, false, 5) + widened;
    expect(widened).toBeGreaterThan(Math.abs(recovered - widened));
  });
});
