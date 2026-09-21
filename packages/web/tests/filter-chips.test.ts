import { describe, expect, it } from 'vitest';
import { chipsFor, clearableCount } from '../src/lib/filter-chips.ts';
import { clearedFilters, emptyFilters, type Filters } from '../src/lib/filters.ts';

const labels = new Map([
  ['region', 'Region'],
  ['region:uk', 'United Kingdom'],
  ['region:ch', 'Switzerland'],
  ['grade', 'Use case grade'],
  ['grade:A', 'A · AI use case'],
  ['maturity', 'Stage'],
  ['maturity:announced', 'Announced'],
  ['agent_stage', 'Agents running?'],
  ['agent_stage:announced', 'Announced'],
]);

const f = (over: Partial<Filters> = {}): Filters => ({ ...emptyFilters(), ...over });

const texts = (filters: Filters) => chipsFor(filters, labels).map((c) => c.text);
const chip = (filters: Filters, id: string) => {
  const found = chipsFor(filters, labels).find((c) => c.id === id);
  if (!found) throw new Error(`no chip ${id} in ${texts(filters).join(' | ')}`);
  return found;
};

describe('the chip row', () => {
  it('names the dimension as well as the value', () => {
    // "Announced" is a value in two dimensions — how far along the use case is,
    // and how far along the agents are. A row of bare values would show the
    // same word twice with no way to tell which filter either one undoes.
    const both = f({ maturities: ['announced'], agentStages: ['announced'] });
    expect(texts(both)).toContain('Stage: Announced');
    expect(texts(both)).toContain('Agents running?: Announced');
  });

  it('falls back to the raw key rather than to a blank chip', () => {
    // A value the taxonomy has no label for is a classifier or migration bug,
    // and a chip reading "Region: " would hide it. Ugly beats invisible.
    expect(texts(f({ regions: ['atlantis'] }))).toContain('Region: atlantis');
  });

  it('gives one chip per selected value, not one per dimension', () => {
    expect(texts(f({ regions: ['uk', 'ch'] }))).toEqual(expect.arrayContaining([
      'Region: United Kingdom', 'Region: Switzerland',
    ]));
  });

  it("removes exactly its own value and touches nothing else", () => {
    // The whole contract. A chip that cleared its dimension would silently
    // drop the reader's other selections in it.
    const before = f({ regions: ['uk', 'ch'], grades: ['A'], search: 'agents' });
    const next = chip(before, 'regions:uk').next;
    expect(next.regions).toEqual(['ch']);
    expect(next.grades).toEqual(['A']);
    expect(next.search).toBe('agents');
  });

  it('chips the Swiss institutions set by clicking a bar', () => {
    // Not a dropdown dimension: it is only ever set from the chart. Without a
    // chip the only way out would be finding the same bar and clicking again.
    const next = chip(f({ chInstitutions: ['UBS'] }), 'chInstitutions:UBS').next;
    expect(next.chInstitutions).toEqual([]);
  });

  it('chips the search box and the AI-focus floor', () => {
    const filters = f({ search: 'copilot', minAiIntensity: 60 });
    expect(texts(filters)).toContain('Search: copilot');
    expect(texts(filters)).toContain('AI focus 60+');
    expect(chip(filters, 'minAiIntensity').next.minAiIntensity).toBeNull();
  });

  it('keeps a floor of zero, which is a setting and not an absence', () => {
    // `0` is falsy, and an early version dropped this chip — so a view filtered
    // to "any AI focus at all" looked unfiltered.
    expect(texts(f({ minAiIntensity: 0 }))).toContain('AI focus 0+');
  });

  it('does not reshuffle as values come and go', () => {
    // Chips are emitted in FILTER_KEY's declaration order. A row whose chips
    // move when you click one is a row you must re-read before every click.
    const a = texts(f({ regions: ['uk'], grades: ['A'] }));
    const b = texts(f({ grades: ['A'], regions: ['uk'] }));
    expect(a).toEqual(b);
  });
});

describe('the date window chip', () => {
  it('is always there, because an unexplained window is the original bug', () => {
    // The Lens opens on 1 July 2026 and the Archive on everything, so the two
    // report different totals for one database. A row that simply omitted the
    // window would make that look like a different set of articles.
    expect(chipsFor(f(), labels)[0]!.id).toBe('window');
    expect(chipsFor(f({ from: '2026-07-01' }), labels)[0]!.id).toBe('window');
  });

  it('reads as a date, not as an ISO string', () => {
    expect(chip(f({ from: '2026-07-01' }), 'window').text).toBe('Since 1 Jul 2026');
  });

  it('clears both ends, and then offers the default back', () => {
    const open = chip(f({ from: '2026-07-01', to: '2026-08-01' }), 'window');
    expect(open.action).toBe('remove');
    expect(open.next.from).toBe('');
    expect(open.next.to).toBe('');

    // This is the old "Show all dates" / "Back to 1 July 2026" pair, relocated:
    // with no window there is nothing to remove, so the chip is the offer.
    const none = chip(open.next, 'window');
    expect(none.action).toBe('restore');
    expect(none.text).toBe('All dates · back to 1 Jul 2026');
    expect(none.next.from).toBe('2026-07-01');
  });
});

describe('clear all', () => {
  it('is offered only when something it clears is set', () => {
    // The date window survives clearing, so a button enabled by the window
    // alone would be a button that does nothing.
    expect(clearableCount(f({ from: '2026-07-01' }))).toBe(0);
    expect(clearableCount(f({ from: '2026-07-01', grades: ['A'] }))).toBe(1);
  });

  it('keeps the view settings and the queue', () => {
    // Clearing filters must not move the reviewer to a different queue, nor
    // reorder the table under them.
    const before = f({
      regions: ['uk'], grades: ['A'], search: 'agents',
      from: '2026-07-01', to: '2026-08-01',
      sort: 'published', sortDir: 'desc', hilDecision: 'undecided',
    });
    const after = clearedFilters(before);
    expect(after).toMatchObject({
      from: '2026-07-01', to: '2026-08-01',
      sort: 'published', sortDir: 'desc', hilDecision: 'undecided',
    });
    expect(after.regions).toEqual([]);
    expect(after.grades).toEqual([]);
    expect(after.search).toBe('');
  });

  it('leaves only the window chip behind', () => {
    const before = f({ regions: ['uk'], grades: ['A'], minAiIntensity: 40 });
    expect(chipsFor(clearedFilters(before), labels).map((c) => c.id)).toEqual(['window']);
  });
});
