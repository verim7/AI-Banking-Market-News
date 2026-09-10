import { describe, expect, it } from 'vitest';
import {
  chNexusOf, CH_NEXUS_ORDER, SWISS_INSTITUTIONS, SWISS_PLACE_TERMS,
} from '../src/swiss.ts';

const nexus = (title: string, body = '', swissSource = false) =>
  chNexusOf({ title, body, swissSource });

describe('reading an article’s Swiss nexus', () => {
  it('reads a Swiss institution in the headline as the strongest grade', () => {
    expect(nexus('UBS deploys an AI assistant for client advisers'))
      .toEqual({ nexus: 'institution', evidence: 'UBS' });
  });

  it('reads the same institution in four languages as one institution', () => {
    // Swiss banking news is written in four languages, and a registry holding
    // one form of a name silently drops the rest of its coverage.
    const forms = [
      'Zürcher Kantonalbank testet KI-Agenten',
      'Zurcher Kantonalbank trials AI agents',
      'ZKB rolls out an AI assistant',
    ];
    const names = forms.map((f) => nexus(f).evidence);
    expect(new Set(names)).toEqual(new Set(['Zürcher Kantonalbank']));
  });

  it('drops to a mention when the institution is only in the body', () => {
    // A supplier win, a survey, a panel: real Swiss content, one step removed.
    // The headline/body split is the same evidence rule tagsFor applies.
    expect(nexus('Core banking vendor lands a major AI contract',
                 'Avaloq will supply the platform to Raiffeisen Schweiz.'))
      .toEqual({ nexus: 'mention', evidence: 'Avaloq' });
  });

  it('falls to press when only the place is named', () => {
    expect(nexus('Swiss wealth managers weigh generative AI').nexus).toBe('press');
  });

  it('lets a Swiss publisher reach press and no further', () => {
    // finews.ch writing about Citi is not Swiss banking news. It is the tier
    // the region tag conflates with the other two, which is the whole reason
    // this file exists.
    expect(nexus('Citi rolls out an AI assistant', '', true))
      .toEqual({ nexus: 'press', evidence: 'Swiss publisher' });
  });

  it('says nothing rather than guessing', () => {
    expect(nexus('DBS rolls out agentic AI to draft credit memos'))
      .toEqual({ nexus: null, evidence: null });
  });

  it('does not read a foreign bank with a Swiss branch as Swiss', () => {
    // Bank of Singapore has a Zurich branch and was on the registry for one
    // measurement, which put two grade-A rows about an OCBC wealth programme
    // run out of Singapore onto a page whose claim is "the banks down the road".
    expect(nexus('Bank of Singapore uses agentic AI for wealth client onboarding').nexus)
      .toBeNull();
  });
});

describe('the registry’s terms, where a false positive costs most', () => {
  it('does not read the number six as the exchange', () => {
    expect(nexus('Six banks join an AI consortium').nexus).toBeNull();
    expect(nexus('SIX Group launches an AI service').evidence).toBe('SIX Group');
  });

  it('does not read the word neon as the neobank', () => {
    expect(nexus('AI in neon lights: the year in banking technology').nexus).toBeNull();
    expect(nexus('neon bank adds an AI budgeting assistant').evidence).toBe('neon');
  });

  it('holds every term lowercased, so the matcher sees what it expects', () => {
    const wrong = SWISS_INSTITUTIONS.flatMap((i) => i.terms)
      .filter((t) => t !== t.toLowerCase());
    expect(wrong).toEqual([]);
  });

  it('never gives one term to two institutions', () => {
    // Two owners means the evidence a row shows depends on list order, and the
    // "By Swiss institution" chart would split one bank across two bars.
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const i of SWISS_INSTITUTIONS) {
      for (const t of i.terms) {
        if (seen.has(t) && seen.get(t) !== i.name) clashes.push(`${t}: ${seen.get(t)} / ${i.name}`);
        seen.set(t, i.name);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('covers all 24 cantonal banks', () => {
    // The cantonal banks are the reason this page was asked for. Missing one is
    // not a rounding error — it is a peer the reader cannot see.
    expect(SWISS_INSTITUTIONS.filter((i) => i.kind === 'cantonal')).toHaveLength(24);
  });

  it('keeps the place terms out of the institution list', () => {
    // "Swiss" is not an institution. If it were, every article mentioning the
    // country would claim the strongest grade and the page would be the region
    // filter again under a new name.
    const overlap = SWISS_INSTITUTIONS.flatMap((i) => i.terms)
      .filter((t) => SWISS_PLACE_TERMS.includes(t));
    expect(overlap).toEqual([]);
  });

  it('orders the grades strongest first, which the Lens depends on', () => {
    expect(CH_NEXUS_ORDER).toEqual(['institution', 'mention', 'press']);
  });
});
