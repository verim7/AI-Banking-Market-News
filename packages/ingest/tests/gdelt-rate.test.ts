import { describe, expect, it } from 'vitest';
import {
  gapReport, isRateLimited, nextGap, noteOutcome, resetGdeltState,
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
  // Driven through noteOutcome rather than real requests. The previous version
  // of this test called fetchGdelt six times and passed only because the
  // authoring sandbox cannot reach GDELT, so every call failed instantly at
  // the connection. On CI, where GDELT answers, the same test made six real
  // rate-limited requests and timed out — it was asserting on the network, not
  // on this code.

  it('reports blocked once refusals stack up, and not before', () => {
    resetGdeltState();
    expect(gapReport().blocked).toBe(false);

    for (let i = 0; i < 5; i++) noteOutcome(true);
    expect(gapReport().blocked).toBe(false);   // five is not yet a pattern

    noteOutcome(true);
    expect(gapReport().blocked).toBe(true);    // six is
  });

  it('widens the gap as it is refused', () => {
    resetGdeltState();
    const before = gapReport().gapSeconds;
    noteOutcome(true);
    expect(gapReport().gapSeconds).toBeGreaterThan(before);
  });

  it('clears the blocked state the moment a request succeeds', () => {
    // One good response means GDELT is talking to us again, so retries should
    // resume immediately rather than stay suppressed for the rest of the run.
    resetGdeltState();
    for (let i = 0; i < 8; i++) noteOutcome(true);
    expect(gapReport().blocked).toBe(true);

    noteOutcome(false);
    expect(gapReport().blocked).toBe(false);
  });

  it('recovers the spacing only after a run of clean responses', () => {
    resetGdeltState();
    for (let i = 0; i < 4; i++) noteOutcome(true);
    const widened = gapReport().gapSeconds;

    noteOutcome(false);
    expect(gapReport().gapSeconds).toBe(widened);   // one is not enough

    for (let i = 0; i < 4; i++) noteOutcome(false);
    expect(gapReport().gapSeconds).toBeLessThan(widened);
  });
});
