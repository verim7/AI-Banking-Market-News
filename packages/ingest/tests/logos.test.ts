import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missingLogos, pickItem, pickLogoFile, wantsLogo, withSlugs } from '../src/logos.ts';
import type { Institution } from '../../web/src/lib/tiers.ts';

const inst = (name: string, group: Institution['group'], rank?: 1 | 2 | 3, aliases?: string[]): Institution =>
  ({ name, group, basis: 'test', ...(rank ? { rank } : {}), ...(aliases ? { aliases } : {}) });

describe('which institutions get a logo', () => {
  it('Tier 1, Tier 2 and providers of rank 1 or 2; not Tier 3, digital banks or young providers', () => {
    expect(wantsLogo(inst('A', 'tier1'))).toBe(true);
    expect(wantsLogo(inst('B', 'tier2'))).toBe(true);
    expect(wantsLogo(inst('C', 'provider', 1))).toBe(true);
    expect(wantsLogo(inst('D', 'provider', 2))).toBe(true);
    expect(wantsLogo(inst('E', 'provider', 3))).toBe(false);
    expect(wantsLogo(inst('F', 'provider'))).toBe(false);
    expect(wantsLogo(inst('G', 'tier3'))).toBe(false);
    expect(wantsLogo(inst('H', 'digital'))).toBe(false);
  });

  it('only those without a file, and only the names asked for when names are given', () => {
    const all = [inst('Emirates NBD', 'tier2'), inst('HSBC', 'tier1'), inst('Airwallex', 'provider', 2), inst('LHV Bank', 'tier3', undefined, ['LHV'])];
    const have = new Set(['hsbc']);
    expect(missingLogos(all, have).map((i) => i.name)).toEqual(['Emirates NBD', 'Airwallex']);
    expect(missingLogos(all, have, ['Airwallex']).map((i) => i.name)).toEqual(['Airwallex']);
    // Asked for by name, an institution outside the tiers is fetched too, under any alias.
    expect(missingLogos(all, have, ['LHV']).map((i) => i.name)).toEqual(['LHV Bank']);
  });
});

describe('the logo on Wikidata', () => {
  const claim = (file: string, rank = 'normal', ended = false) => ({
    rank, mainsnak: { datavalue: { value: file } }, ...(ended ? { qualifiers: { P582: [{}] } } : {}),
  });

  it('prefers the preferred logo, skips deprecated and retired ones', () => {
    expect(pickLogoFile([claim('old.svg', 'normal', true), claim('new.svg')])).toBe('new.svg');
    expect(pickLogoFile([claim('a.svg'), claim('b.svg', 'preferred')])).toBe('b.svg');
    expect(pickLogoFile([claim('x.svg', 'deprecated')])).toBeNull();
    expect(pickLogoFile([])).toBeNull();
  });

  it('takes the item of the first real article, following redirects, never a disambiguation page', () => {
    const response = {
      query: {
        redirects: [{ from: 'Citi', to: 'Citigroup' }],
        pages: {
          '1': { title: 'Citigroup', pageprops: { wikibase_item: 'Q219508' } },
          '-1': { title: 'Citibank', missing: '' },
        },
      },
    };
    expect(pickItem(['Citi', 'Citibank'], response)).toBe('Q219508');
    const ambiguous = { query: { pages: { '2': { title: 'Mal', pageprops: { disambiguation: '', wikibase_item: 'Q1' } } } } };
    expect(pickItem(['Mal'], ambiguous)).toBeNull();
  });
});

describe('LOGO_SLUGS in institutions.ts', () => {
  const file = readFileSync(resolve(import.meta.dirname, '../../web/src/lib/institutions.ts'), 'utf8');

  it('is rewritten byte for byte when nothing is added', () => {
    expect(withSlugs(file, [])).toBe(file);
  });

  it('takes new slugs in alphabetical order, once', () => {
    const out = withSlugs(file, ['emirates-nbd', 'airwallex', 'hsbc']);
    const block = out.slice(out.indexOf('new Set<string>(['), out.indexOf(']);', out.indexOf('new Set<string>([')));
    const slugs = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(slugs).toEqual([...slugs].sort());
    expect(slugs.filter((s) => s === 'hsbc')).toHaveLength(1);
    expect(slugs).toContain('airwallex');
    expect(slugs).toContain('emirates-nbd');
    for (const line of block.split('\n')) expect(line.length).toBeLessThanOrEqual(93);
  });
});
