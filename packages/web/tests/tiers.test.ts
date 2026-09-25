import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BANDS, G_SIBS, INSTITUTIONS, nameKey, tierLabel, tierOf,
} from '../src/lib/tiers.ts';

describe('the tiers', () => {
  it('holds Tier 1 to the FSB list exactly, no more and no fewer', () => {
    // A bank promoted to Tier 1 by hand, or a G-SIB left in Tier 2, is the
    // error that makes a tier an opinion.
    const tier1 = INSTITUTIONS.filter((i) => i.group === 'tier1').map((i) => i.name);
    expect(G_SIBS).toHaveLength(29);
    expect([...tier1].sort()).toEqual([...G_SIBS].sort());
  });

  it('puts the three banks it was asked about in Tier 1', () => {
    for (const name of ['UBS', 'HSBC', 'Deutsche Bank']) {
      expect(tierOf(name).band, name).toBe('tier1');
    }
  });

  it('shows the bands in the order the board reads', () => {
    expect(BANDS.map((b) => b.key)).toEqual(
      ['tier1', 'tier2', 'tier3', 'digital', 'provider', 'authority', 'untiered']);
  });

  it('knows one institution by every name reviewers write it under', () => {
    expect(tierOf('Starling').institution?.name).toBe('Starling Bank');
    expect(tierOf('Bank of America Merrill').institution?.name).toBe('Bank of America');
    expect(tierOf('Societe Generale').institution?.name).toBe('Société Générale');
    expect(tierOf('US Bank').institution?.name).toBe('U.S. Bank');
    expect(tierOf('  hsbc ').band).toBe('tier1');
  });

  it('files a joint use case under the largest institution in it', () => {
    expect(tierOf('Citi, HSBC and four other global banks').institution?.name).toBe('Citi');
    expect(tierOf('Santander and Mastercard').band).toBe('tier1');
    expect(tierOf('Revolut and Visa').band).toBe('digital');
    expect(tierOf('IndusInd Bank and Razorpay').band).toBe('tier3');
  });

  it('ranks providers inside their band, largest first', () => {
    expect(tierOf('Visa').rank).toBeLessThan(tierOf('GoCardless').rank);
    expect(tierOf('GoCardless').rank).toBeLessThan(tierOf('Sokin').rank);
  });

  it('does not guess a name it does not hold', () => {
    expect(tierOf('Acme Savings')).toEqual({ band: 'untiered', rank: 1, institution: null });
    expect(tierOf('').band).toBe('untiered');
  });

  it('has no name that points at two institutions', () => {
    const seen = new Map<string, string>();
    for (const i of INSTITUTIONS) {
      for (const n of [i.name, ...(i.aliases ?? [])]) {
        const k = nameKey(n);
        expect(seen.get(k) ?? i.name, `${n} is claimed twice`).toBe(i.name);
        seen.set(k, i.name);
      }
    }
  });

  it('says why every institution sits where it does', () => {
    for (const i of INSTITUTIONS) {
      expect(i.basis.trim(), i.name).not.toBe('');
      // Only providers carry a rank of their own; a bank is ranked by its tier.
      if (i.group !== 'provider') expect(i.rank, i.name).toBeUndefined();
      else expect(i.rank, i.name).toBeDefined();
    }
  });
});

describe('a tier in a table cell', () => {
  it('names the tier and the kind of institution in a few words', () => {
    expect(tierLabel(tierOf('UBS'))).toBe('Tier 1 bank');
    expect(tierLabel(tierOf('DBS'))).toBe('Tier 2 bank');
    expect(tierLabel(tierOf('Saffron Building Society'))).toBe('Tier 3 bank');
    expect(tierLabel(tierOf('Revolut'))).toBe('Digital bank');
    expect(tierLabel(tierOf('Visa'))).toBe('Tier 1 provider');
    expect(tierLabel(tierOf('Sokin'))).toBe('Tier 3 provider');
    expect(tierLabel(tierOf('Bank of England'))).toBe('Regulator');
    expect(tierLabel(tierOf('Acme Savings'))).toBe('Not tiered');
  });

  it('has a label for every band', () => {
    for (const b of BANDS) {
      expect(tierLabel({ band: b.key, rank: 1, institution: null })).not.toBe('');
    }
  });
});

/**
 * Every institution a reviewer has ever graded A has a tier.
 *
 * The decision files are the only source of the names on the board, so this
 * is the check that a review pass naming a new institution tiers it in the
 * same commit — rather than leaving it to surface under "Not yet tiered" on
 * the page an executive reads.
 */
describe('the review decisions', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const dir = join(root, 'data/review/decisions');

  const actors = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const d = JSON.parse(line) as { grade?: string; actor?: string | null };
      if (d.grade === 'A' && d.actor?.trim()) actors.add(d.actor.trim());
    }
  }

  it('were read at all', () => {
    // Without this, an empty directory would make the next test pass.
    expect(actors.size).toBeGreaterThan(50);
  });

  it('name no institution without a tier', () => {
    const missing = [...actors].filter((a) => tierOf(a).band === 'untiered').sort();
    expect(missing, 'add these to packages/web/src/lib/tiers.ts').toEqual([]);
  });
});
