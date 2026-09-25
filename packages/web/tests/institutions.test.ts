import { describe, expect, it } from 'vitest';
import {
  bandsFor, boardFor, boardMessage, logoSlug, monogram, STAGES, unstatedCount,
  type Reviewed,
} from '../src/lib/institutions.ts';
import { groupArticles, type Group } from '../src/lib/group-articles.ts';

const row = (over: Partial<Reviewed> & { id: string }): Reviewed => ({
  url: `https://example.test/${over.id}`,
  title: 'A title',
  publishedAt: '2026-09-18T00:00:00.000Z',
  maturity: 'in_production',
  groupKey: null,
  useCaseEvidence: null,
  review: null,
  ...over,
});

const reviewed = (actor: string, task: string, grade = 'A') =>
  ({ grade, headline: `${actor} does something`, actor, task });

describe('a monogram', () => {
  it('takes one letter per significant word', () => {
    expect(monogram('Starling Bank')).toBe('SB');
    expect(monogram('NH NongHyup Bank')).toBe('NNB');
  });

  it('keeps an acronym whole', () => {
    // Shortening DBS to DB names a different bank, on the same board.
    expect(monogram('DBS')).toBe('DBS');
    expect(monogram('ING')).toBe('ING');
  });

  it('drops the joining words but keeps "Bank"', () => {
    // "of" carries no identity. "Bank" does: without it Deutsche Bank and
    // Deutsche Börse collide, and a monogram that collides is worse than a
    // long one.
    expect(monogram('Bank of Baroda')).toBe('BB');
    expect(monogram('Deutsche Bank')).toBe('DB');
    expect(monogram('Deutsche Börse')).toBe('DB');
  });

  it('gives a single ordinary word two letters', () => {
    expect(monogram('Revolut')).toBe('RE');
    expect(monogram('Zopa')).toBe('ZO');
  });

  it('survives punctuation, accents and a name of nothing', () => {
    expect(monogram('Citi, HSBC, Standard Chartered')).toBe('CHS');
    expect(monogram('Société Générale')).toBe('SG');
    expect(monogram('   ')).toBe('?');
  });

  it('never emits more than three letters', () => {
    // It sits in a 34px tile beside the name. Four letters overflow it.
    for (const n of ['Citi, HSBC, Standard Chartered and Barclays',
                     'The Bank of New York Mellon', 'A B C D E']) {
      expect(monogram(n).length).toBeLessThanOrEqual(4);
    }
  });
});

describe('a logo slug', () => {
  it('is the filename someone would drop in public/logos', () => {
    expect(logoSlug('Starling Bank')).toBe('starling-bank');
    expect(logoSlug('Citi, HSBC')).toBe('citi-hsbc');
    expect(logoSlug('ING')).toBe('ing');
  });
});

describe('the board', () => {
  const groups = (rows: Reviewed[]): Group<Reviewed>[] => groupArticles(rows);

  it('has the three rungs in order, even when empty', () => {
    const b = boardFor([]);
    expect(b.map((s) => s.key)).toEqual(['announced', 'pilot', 'in_production']);
    expect(b.every((s) => s.entries.length === 0)).toBe(true);
    // The count as well as the contents: `[].every()` is true, so without this
    // a board of zero stages would pass the line above.
    expect(b).toHaveLength(STAGES.length);
  });

  it('places each use case on the rung the reviewer stated', () => {
    const b = boardFor(groups([
      row({ id: '1', maturity: 'announced', review: reviewed('Mastercard', 'agentic commerce') }),
      row({ id: '2', maturity: 'pilot', review: reviewed('Zopa', 'a trial') }),
      row({ id: '3', maturity: 'in_production', review: reviewed('DBS', 'daily use') }),
    ]));
    expect(b.map((s) => s.entries.map((e) => e.actor))).toEqual([
      ['Mastercard'], ['Zopa'], ['DBS'],
    ]);
  });

  it('admits only a reviewed A with a named institution', () => {
    // This is the page an executive reads. A B is the news around the use
    // cases and an unreviewed row is the classifier's guess; neither belongs
    // printed under a bank's name.
    const b = boardFor(groups([
      row({ id: 'b', review: reviewed('Acme', 'something', 'B') }),
      row({ id: 'none', review: null }),
      row({ id: 'noactor', review: { ...reviewed('x', 'y'), actor: null } }),
      row({ id: 'blank', review: { ...reviewed('x', 'y'), actor: '   ' } }),
      row({ id: 'ok', review: reviewed('DBS', 'daily use') }),
    ]));
    expect(b.flatMap((s) => s.entries).map((e) => e.id)).toEqual(['ok']);
  });

  it('does not invent a rung for a use case with no stated stage', () => {
    // "unknown" is not "early". Placing it under Announced would print a claim
    // the article never made, on the page least able to afford one.
    const rows = [
      row({ id: 'u', maturity: 'unknown', review: reviewed('Acme', 'x') }),
      row({ id: 'r', maturity: 'research', review: reviewed('Beta', 'y') }),
    ];
    expect(boardFor(groups(rows)).flatMap((s) => s.entries)).toHaveLength(0);
    // And it is counted, so the page can say what it is not showing.
    expect(unstatedCount(groups(rows))).toBe(2);
  });

  it('shows one use case once, however many outlets reported it', () => {
    const b = boardFor(groups([
      // The thin aggregator arrives first, as the newest report usually does.
      row({ id: 'thin', groupKey: 'dbs:p05', review: null }),
      row({ id: 'full', groupKey: 'dbs:p05', review: reviewed('DBS', 'served 2m clients') }),
      row({ id: 'also', groupKey: 'dbs:p05', review: null }),
    ]));
    const entries = b.flatMap((s) => s.entries);
    expect(entries).toHaveLength(1);
    // Led by the report that actually describes it, not by the one that landed
    // last — the same rule the Market Lens table folds by.
    expect(entries[0]!.actor).toBe('DBS');
    expect(entries[0]!.reports).toBe(3);
  });

  it('carries the reviewer’s task, not the headline', () => {
    const [entry] = boardFor(groups([
      row({ id: '1', review: reviewed('DBS', 'answer client queries') }),
    ])).flatMap((s) => s.entries);
    expect(entry!.task).toBe('answer client queries');
  });
});

describe('the board, ranked by size', () => {
  const b = () => boardFor(groupArticles([
    // Newest first, as the page asks for them: the smallest institutions
    // arrive first, so an order that merely kept arrival order would fail.
    row({ id: 'fin', review: reviewed('Concryt', 'monitors payments') }),
    row({ id: 'neo', review: reviewed('Starling Bank', 'answers customers') }),
    row({ id: 't2', review: reviewed('DBS', 'daily use') }),
    row({ id: 'who', review: reviewed('Acme Savings', 'something') }),
    row({ id: 't1', review: reviewed('Deutsche Bank', 'source of wealth checks') }),
    row({ id: 'net', review: reviewed('Visa', 'agentic payments') }),
  ]));

  it('puts Tier 1 first, then Tier 2, digital banks, providers, and the unplaced last', () => {
    const inProd = b().find((s) => s.key === 'in_production')!;
    expect(inProd.entries.map((e) => e.actor)).toEqual([
      'Deutsche Bank', 'DBS', 'Starling Bank', 'Visa', 'Concryt', 'Acme Savings',
    ]);
  });

  it('ranks by reports inside a tier, and keeps newest first after that', () => {
    const stage = boardFor(groupArticles([
      row({ id: 'new', review: reviewed('HSBC', 'one report') }),
      row({ id: 'a', groupKey: 'citi', review: reviewed('Citi', 'three reports') }),
      row({ id: 'b', groupKey: 'citi', review: null }),
      row({ id: 'c', groupKey: 'citi', review: null }),
      row({ id: 'old', review: reviewed('UBS', 'one report, older') }),
    ])).find((s) => s.key === 'in_production')!;
    expect(stage.entries.map((e) => e.actor)).toEqual(['Citi', 'HSBC', 'UBS']);
  });

  it('cuts into bands that leave out the empty ones and keep every stage', () => {
    const bands = bandsFor(b());
    expect(bands.map((x) => x.key)).toEqual(
      ['tier1', 'tier2', 'digital', 'provider', 'untiered']);
    for (const band of bands) {
      // One cell per stage, in stage order, so each lines up under its head.
      expect(band.cells.map((c) => c.stage)).toEqual(STAGES.map((s) => s.key));
      expect(band.count).toBe(band.cells.reduce((n, c) => n + c.entries.length, 0));
    }
    // Every entry lands in exactly one band.
    const total = b().reduce((n, s) => n + s.entries.length, 0);
    expect(bands.reduce((n, x) => n + x.count, 0)).toBe(total);
    expect(total).toBe(6);
  });

  it('has no bands at all when the board is empty', () => {
    expect(bandsFor(boardFor([]))).toEqual([]);
  });
});

describe('the sentence above the board', () => {
  const board = (announced: number, pilot: number, running: number) =>
    boardFor(groupArticles([
      ...Array.from({ length: announced }, (_, i) =>
        row({ id: `a${i}`, maturity: 'announced', review: reviewed(`Bank A${i}`, 'x') })),
      ...Array.from({ length: pilot }, (_, i) =>
        row({ id: `p${i}`, maturity: 'pilot', review: reviewed(`Bank P${i}`, 'x') })),
      ...Array.from({ length: running }, (_, i) =>
        row({ id: `r${i}`, maturity: 'in_production', review: reviewed(`Bank R${i}`, 'x') })),
    ]));

  it('counts use cases, the unit of the board underneath it', () => {
    // It used to say "4 of 5 articles" over a board of 3 use cases — two
    // different numbers for one question, a few pixels apart.
    expect(boardMessage(board(0, 1, 2)))
      .toBe('2 of 3 named use cases in this view are already running.');
  });

  it('agrees with the board by construction', () => {
    // The numbers in the sentence are the board's own column lengths.
    const b = board(2, 3, 4);
    const running = b.find((st) => st.key === 'in_production')!.entries.length;
    const total = b.reduce((n, st) => n + st.entries.length, 0);
    expect(boardMessage(b)).toBe(`${running} of ${total} named use cases in this view are already running.`);
  });

  it('reads correctly at the edges', () => {
    expect(boardMessage(board(0, 0, 0))).toBe('No named use cases in this view yet.');
    expect(boardMessage(board(1, 1, 0)))
      .toBe('2 named use cases in this view, none of them running yet.');
    expect(boardMessage(board(0, 0, 3))).toBe('All 3 named use cases in this view are already running.');
    expect(boardMessage(board(0, 0, 1))).toBe('The one named use case in this view is already running.');
    expect(boardMessage(board(0, 1, 1))).toBe('1 of 2 named use cases in this view is already running.');
  });
});
