import { describe, expect, it } from 'vitest';
import { banks, nameClause, plan, queryUrl, windows } from '../src/swiss-backfill.ts';

const NOW = new Date(Date.UTC(2026, 9, 30));

describe('swiss backfill windows', () => {
  it('walks half-years from January 2024 without a gap', () => {
    const w = windows('half', NOW);
    expect(w.map((x) => x.label)).toEqual(['2024H1', '2024H2', '2025H1', '2025H2', '2026H1', '2026H2']);
    expect(w[0]!.after).toBe('2023-12-31');
    expect(w[0]!.before).toBe('2024-07-01');
    expect(w[1]!.after).toBe('2024-06-30');
  });

  it('walks months for the big bank', () => {
    expect(windows('month', NOW)).toHaveLength(34);
  });
});

describe('swiss backfill queries', () => {
  it('asks about banks only, and not Credit Suisse', () => {
    const names = banks().map((b) => b.name);
    expect(names).toContain('UBS');
    expect(names).not.toContain('Credit Suisse');
    expect(banks().every((b) => b.kind !== 'authority' && b.kind !== 'infrastructure')).toBe(true);
  });

  it('adds a short alias next to a long name', () => {
    const zkb = banks().find((b) => b.terms.includes('zkb'))!;
    expect(nameClause(zkb)).toContain('"ZKB"');
  });

  it('builds a dated, edition-specific Google News search', () => {
    const ubs = banks().find((b) => b.name === 'UBS')!;
    const url = queryUrl(ubs, windows('month', NOW)[0]!, 'de');
    const q = decodeURIComponent(new URL(url).searchParams.get('q')!);
    expect(q).toContain('"UBS"');
    expect(q).toContain('"künstliche Intelligenz"');
    expect(q).toContain('after:2023-12-31 before:2024-02-01');
    expect(url).toContain('ceid=CH%3Ade');
  });

  it('plans English only for banks the international press follows', () => {
    const p = plan(NOW);
    expect(p.some((r) => r.key === 'UBS|en')).toBe(true);
    expect(p.filter((r) => r.key.endsWith('|en'))
      .every((r) => ['big_bank', 'private', 'digital', 'crypto']
        .includes(banks().find((b) => b.name === r.bank)!.kind))).toBe(true);
    expect(new Set(p.map((r) => `${r.window}|${r.key}`)).size).toBe(p.length);
  });
});
