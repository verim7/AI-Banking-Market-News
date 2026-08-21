import { useMemo } from 'react';
import { emptyFilters } from '../api.ts';
import type { Filters, TaxonomyDimension } from '../api.ts';
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

const FILTER_KEY: Record<string, keyof Filters> = {
  region: 'regions',
  banking_area: 'bankingAreas',
  bank_category: 'bankCategories',
  use_case: 'useCases',
  ai_type: 'aiTypes',
  l1_process: 'l1Processes',
  publisher_kind: 'publisherKinds',
  maturity: 'maturities',
};

const PUBLISHER_LABELS: Record<string, string> = {
  consultancy: 'Consultancy',
  regulator: 'Regulator',
  bank: 'Bank',
  media: 'Media',
};

const STAGE_LABELS: Record<string, string> = {
  in_production: 'In production',
  pilot: 'Pilot / testing',
  announced: 'Announced',
  research: 'Study',
  unknown: 'Not stated',
};

export interface Facet { dimension: string; value: string; n: number }

export function FilterBar({
  taxonomy, filters, onChange, facets = [], showDates = true,
}: {
  taxonomy: TaxonomyDimension[];
  filters: Filters;
  onChange: (f: Filters) => void;
  facets?: Facet[];
  showDates?: boolean;
}) {
  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of taxonomy) for (const v of d.values) map.set(`${d.dimension}:${v.value}`, v.label);
    for (const [k, v] of Object.entries(PUBLISHER_LABELS)) map.set(`publisher_kind:${k}`, v);
    for (const [k, v] of Object.entries(STAGE_LABELS)) map.set(`maturity:${k}`, v);
    return map;
  }, [taxonomy]);

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
        label: labels.get(`${dimension}:${f.value}`) ?? f.value,
        count: f.n,
      }));

    const present = new Set(live.map((o) => o.value));
    for (const v of chosen) {
      if (!present.has(v)) {
        live.push({ value: v, label: labels.get(`${dimension}:${v}`) ?? v, count: 0 });
      }
    }
    return live.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };

  const set = (key: keyof Filters, value: unknown) => onChange({ ...filters, [key]: value });

  const dimensions = [
    ...taxonomy.map((d) => ({ dimension: d.dimension, label: d.label })),
    { dimension: 'maturity', label: 'Stage' },
    { dimension: 'publisher_kind', label: 'Source type' },
  ];

  const active =
    dimensions.reduce((n, d) => {
      const key = FILTER_KEY[d.dimension];
      return n + (key ? ((filters[key] as string[] | undefined)?.length ?? 0) : 0);
    }, 0)
    + (filters.search ? 1 : 0)
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

      <div className="filterbar-row filterbar-row-inputs">
        <div className="field">
          <label htmlFor="f-search">Search</label>
          <input
            id="f-search" type="search" placeholder="keyword…"
            value={filters.search}
            onChange={(e) => set('search', e.currentTarget.value)}
          />
        </div>

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
            onClick={() => onChange({
              ...emptyFilters(),
              // Clearing filters must not move you to another tab: Favorites
              // and the review queue are defined by these two. The date window
              // and sort are view settings, not filters, so they stay too.
              favoritesOnly: filters.favoritesOnly,
              hilDecision: filters.hilDecision,
              from: filters.from,
              to: filters.to,
              sort: filters.sort,
              sortDir: filters.sortDir,
            })}
          >
            Clear{active > 0 ? ` (${active})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
