import { useMemo } from 'react';
import { UNCLASSIFIED, UNCLASSIFIED_LABEL } from '../api.ts';
import type { Filters, TaxonomyDimension } from '../api.ts';
import { clearedFilters, DIMENSION_LABELS, FILTER_KEY } from '../lib/filters.ts';
import { MultiSelect, type Option } from './MultiSelect.tsx';

/**
 * Every filter, driven by live counts.
 *
 * Options come from the facet endpoint, which computes each dimension's counts
 * with the other filters applied but not its own. Two consequences, both of
 * them the point: an option that would return nothing is never offered, and
 * choosing one value in a dimension does not hide the rest of that dimension,
 * so a selection can be built up rather than replaced.
 */

/**
 * The review rubric, in the filter. The words are the ones the reviewer worked
 * from — a legend that drifts from the rubric is worse than no legend.
 */
const GRADE_LABELS: Record<string, string> = {
  A: 'A · AI use case',
  B: 'B · AI market news',
  // Retired rather than removed: the option still has to render if an old row
  // survives somewhere, and an unlabelled letter in a filter is worse than a
  // label saying it is finished with.
  C: 'C · Retired, now B',
  D: 'D · Not relevant',
  unreviewed: 'Not reviewed yet',
};

const PUBLISHER_LABELS: Record<string, string> = {
  consultancy: 'Consultancy',
  regulator: 'Regulator',
  bank: 'Bank',
  media: 'Media',
};

/** The same four words the table's first column uses. Two vocabularies for one
 *  axis would make the filter and the column look like different questions. */
const AGENT_STAGE_LABELS: Record<string, string> = {
  running: 'Live',
  pilot: 'Piloting',
  announced: 'Announced',
  none: 'No agents',
};

/** Why an article counts as Swiss. The words are the ones docs/swiss-coverage.md
 *  uses, so the filter and the document cannot say different things. */
const CH_NEXUS_LABELS: Record<string, string> = {
  institution: 'Institution in the headline',
  mention: 'Institution mentioned',
  press: 'Swiss press or place only',
  none: 'No Swiss link',
};

const STAGE_LABELS: Record<string, string> = {
  in_production: 'In production',
  pilot: 'Pilot / testing',
  announced: 'Announced',
  research: 'Study',
  unknown: 'Not stated',
};

/**
 * Every label this app puts on a filter, in one map.
 *
 * Keyed two ways: `dimension` for the dimension's own name, and
 * `dimension:value` for one of its values. One map rather than two because
 * every caller wants both and a pair of maps is a pair that can disagree.
 *
 * Three places read it — the dropdowns, the chip row and the Lens's bar charts
 * — and they must agree. A chip that says "United Kingdom" next to a dropdown
 * that says "UK" looks like two different filters.
 */
export function filterLabels(taxonomy: TaxonomyDimension[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of taxonomy) {
    map.set(d.dimension, d.label);
    for (const v of d.values) map.set(`${d.dimension}:${v.value}`, v.label);
    // The unclassified bucket is not a taxonomy value, so it has no label of
    // its own. Without this the charts and the chips print the raw sentinel.
    map.set(`${d.dimension}:${UNCLASSIFIED}`, UNCLASSIFIED_LABEL);
  }
  for (const [k, v] of Object.entries(PUBLISHER_LABELS)) map.set(`publisher_kind:${k}`, v);
  for (const [k, v] of Object.entries(STAGE_LABELS)) map.set(`maturity:${k}`, v);
  for (const [k, v] of Object.entries(GRADE_LABELS)) map.set(`grade:${k}`, v);
  for (const [k, v] of Object.entries(AGENT_STAGE_LABELS)) map.set(`agent_stage:${k}`, v);
  for (const [k, v] of Object.entries(CH_NEXUS_LABELS)) map.set(`ch_nexus:${k}`, v);
  for (const [k, v] of Object.entries(DIMENSION_LABELS)) map.set(k, v);
  return map;
}

/**
 * The search box, as its own component.
 *
 * The Market Lens lifts it out of the bar and into the slim top row, leaving
 * the rest of the filters behind a disclosure — so the same input renders in
 * two places, and `id="f-search"` must appear exactly once in the document.
 * One component, one id, and `showSearch` decides which parent draws it.
 */
export function SearchField(
  { value, onChange }: { value: string; onChange: (v: string) => void },
) {
  return (
    <div className="field">
      <label htmlFor="f-search">Search</label>
      <input
        id="f-search" type="search" placeholder="Search headlines and article text"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </div>
  );
}

// Declared in lib/filters.ts, which has no React and no API client in it, so
// that the chip row's pure logic can be unit-tested. See that file.
export { clearedFilters, DIMENSION_LABELS, FILTER_KEY };

export interface Facet { dimension: string; value: string; n: number }

export function FilterBar({
  taxonomy, filters, onChange, facets = [], showDates = true, showSearch = true,
  hide = [], extra = [],
}: {
  taxonomy: TaxonomyDimension[];
  filters: Filters;
  onChange: (f: Filters) => void;
  facets?: Facet[];
  showDates?: boolean;
  /**
   * Whether this bar draws the search box.
   *
   * False on the Market Lens, which draws it in its slim top row so that
   * searching does not mean opening a disclosure first. There must be exactly
   * one `id="f-search"` in the document, so whoever draws it, the other must
   * not.
   */
  showSearch?: boolean;
  /**
   * Dimensions this page does not offer.
   *
   * A filter that can only ever say one thing is not a control, it is a label
   * taking up a control's worth of space — region on a page where every row is
   * Swiss, type of AI on a page that is about one type of AI.
   */
  hide?: string[];
  /** Dimensions this page adds, in the order they should appear. */
  extra?: { dimension: string; label: string }[];
}) {
  const labels = useMemo(() => filterLabels(taxonomy), [taxonomy]);

  /**
   * Whatever the facets report, plus any selected value that has dropped to
   * zero — otherwise a filter that excluded everything could never be undone.
   */
  const optionsFor = (dimension: string): Option[] => {
    const key = FILTER_KEY[dimension];
    const chosen = (key ? (filters[key] as string[] | undefined) : undefined) ?? [];

    const live: Option[] = facets
      .filter((f) => f.dimension === dimension)
      .map((f) => ({
        value: f.value,
        label: f.value === UNCLASSIFIED
          ? UNCLASSIFIED_LABEL
          : labels.get(`${dimension}:${f.value}`) ?? f.value,
        count: f.n,
      }));

    const present = new Set(live.map((o) => o.value));
    for (const v of chosen) {
      if (!present.has(v)) {
        live.push({
          value: v,
          label: v === UNCLASSIFIED ? UNCLASSIFIED_LABEL : labels.get(`${dimension}:${v}`) ?? v,
          count: 0,
        });
      }
    }

    // Residual options sort last whatever their count — "Not classified" and
    // "Not reviewed yet" are both the absence of a value, not a value. A large
    // residual bucket sorted to the top reads as the dimension's leading value,
    // which is the opposite of what it means, and on a fresh corpus "not
    // reviewed" is the largest bucket there is.
    const residual = (v: string) => v === UNCLASSIFIED || v === 'unreviewed';
    return live.sort((a, b) => {
      if (residual(a.value) !== residual(b.value)) return residual(a.value) ? 1 : -1;
      return b.count - a.count || a.label.localeCompare(b.label);
    });
  };

  const set = (key: keyof Filters, value: unknown) => onChange({ ...filters, [key]: value });

  // Only the dimensions the API marks filterable. The rest still arrive in the
  // taxonomy, because their labels are needed by the table and the export.
  const dimensions = [
    ...extra,
    ...taxonomy.filter((d) => d.filterable !== false)
      .map((d) => ({ dimension: d.dimension, label: d.label })),
    { dimension: 'grade', label: DIMENSION_LABELS.grade },
    { dimension: 'maturity', label: DIMENSION_LABELS.maturity },
    { dimension: 'publisher_kind', label: DIMENSION_LABELS.publisher_kind },
  ].filter((d) => !hide.includes(d.dimension));

  // What this bar can clear, which is only what this bar draws. On the Market
  // Lens the search box lives outside the disclosure, so counting it here
  // produced a "Clear (1)" inside More filters with every dropdown empty —
  // a button offering to undo something the reader cannot see from it.
  const active =
    dimensions.reduce((n, d) => {
      const key = FILTER_KEY[d.dimension];
      return n + (key ? ((filters[key] as string[] | undefined)?.length ?? 0) : 0);
    }, 0)
    + (showSearch && filters.search ? 1 : 0)
    + (filters.minAiIntensity !== null && filters.minAiIntensity !== undefined ? 1 : 0);

  return (
    <div className="filterbar">
      <div className="filterbar-row">
        {dimensions.map(({ dimension, label }) => {
          const key = FILTER_KEY[dimension];
          if (!key) return null;
          return (
            <MultiSelect
              key={dimension}
              label={label}
              options={optionsFor(dimension)}
              selected={(filters[key] as string[] | undefined) ?? []}
              onChange={(next) => set(key, next)}
            />
          );
        })}
      </div>

      <p className="subtle" style={{ margin: '2px 0 0', fontSize: 12 }}>
        Every article appears under at least one option in every filter —
        “{UNCLASSIFIED_LABEL}” holds the ones the classifier could not place.
        Counts can add up to more than the view total, because an article can
        carry several values in the same dimension.
      </p>

      <div className="filterbar-row filterbar-row-inputs">
        {showSearch && (
          <SearchField value={filters.search} onChange={(v) => set('search', v)} />
        )}

        {showDates && (
          <>
            <div className="field">
              <label htmlFor="f-from">From</label>
              <input
                id="f-from" type="date" value={filters.from}
                onChange={(e) => set('from', e.currentTarget.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="f-to">To</label>
              <input
                id="f-to" type="date" value={filters.to}
                onChange={(e) => set('to', e.currentTarget.value)}
              />
            </div>
          </>
        )}

        <div className="field field-narrow">
          <label htmlFor="f-ai">Min AI focus</label>
          <input
            id="f-ai" type="number" min={0} max={100} step={5}
            value={filters.minAiIntensity ?? ''}
            placeholder="any"
            onChange={(e) => set('minAiIntensity',
              e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
          />
        </div>

        <div className="field field-end">
          <button
            type="button"
            className="btn-quiet"
            disabled={active === 0}
            // And it clears only what it draws, for the same reason. The chip
            // row's "Clear all" owns the whole view and does clear the search
            // term; this button does not reach outside its own box.
            onClick={() => onChange(showSearch
              ? clearedFilters(filters)
              : { ...clearedFilters(filters), search: filters.search })}
          >
            Clear{active > 0 ? ` (${active})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
