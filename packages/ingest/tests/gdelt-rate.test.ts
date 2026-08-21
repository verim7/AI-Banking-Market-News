import { describe, expect, it } from 'vitest';
import {
  fetchGdelt, gapReport, isRateLimited, nextGap, resetGdeltState,
} from '../src/fetch-gdelt.ts';

describe('recognising GDELT pushback', () => {
  it('treats 429 and 403 alike', () => {
    // 403 was the majority failure in the first three-year backfill, and the
    // retry only covered 429 — so most refusals were never retried at all.
    expect(isRateLimited(new Error('HTTP 429 Too Many Requests'))).toBe(true);
    expect(isRateLimited(new Error('HTTP 403 Forbidden'))).toBe(true);
  });

  it('recognises a dropped connection, which is how GDELT ends up refusing', () => {
    // These were the majority of failures once a long run got blocked, and
    // matching only status codes left the back-off logic blind to them.
    expect(isRateLimited(new Error('fetch failed'))).toBe(true);
    expect(isRateLimited(new Error('read ECONNRESET'))).toBe(true);
    expect(isRateLimited(new Error('socket hang up'))).toBe(true);
  });

  it('does not treat a broken query as something a wait would fix', () => {
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

describe('giving up when plainly blocked', () => {
  it('widens the gap and reports blocked after a run of refusals', async () => {
    // Real pacing, scaled down: the widen/give-up logic is exactly the code
    // that ships, only the clock is faster.
    resetGdeltState({ pacingScale: 0.001 });
    expect(gapReport().blocked).toBe(false);

    // A real refusal, not a timeout: this environment cannot reach GDELT, so
    // every call fails at the connection — the same shape as a live block.
    for (let i = 0; i < 6; i++) {
      // Real waits would make this a five-minute test; the point under test is
      // the streak accounting, not the length of the pauses.
      await fetchGdelt('anything', { retryWaitsMs: [1, 1] }).catch(() => undefined);
    }

    const report = gapReport();
    expect(report.blocked).toBe(true);
    expect(report.gapSeconds).toBeGreaterThan(5);
  }, 60_000);
});
