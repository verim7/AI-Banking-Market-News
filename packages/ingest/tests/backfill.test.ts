import { describe, expect, it } from 'vitest';
import { monthWindows, stamp } from '../src/backfill.ts';

describe('month windows', () => {
  it('covers roughly twelve months for one year', () => {
    const w = monthWindows(1);
    expect(w.length).toBeGreaterThanOrEqual(12);
    expect(w.length).toBeLessThanOrEqual(13);
  });

  it('covers roughly thirty-six months for three years', () => {
    const w = monthWindows(3);
    expect(w.length).toBeGreaterThanOrEqual(36);
    expect(w.length).toBeLessThanOrEqual(37);
  });

  it('runs oldest first and leaves no gap between windows', () => {
    const w = monthWindows(2);
    for (let i = 1; i < w.length; i++) {
      expect(w[i]!.start.getTime()).toBe(w[i - 1]!.end.getTime());
    }
  });

  it('never reaches into the future', () => {
    const w = monthWindows(1);
    expect(w[w.length - 1]!.end.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('formats stamps the way GDELT expects', () => {
    expect(stamp(new Date('2024-03-05T07:08:09Z'))).toBe('20240305070809');
    expect(stamp(new Date('2024-03-05T07:08:09Z'))).toMatch(/^\d{14}$/);
  });
});
