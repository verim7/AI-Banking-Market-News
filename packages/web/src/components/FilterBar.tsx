import type { Filters, TaxonomyDimension } from '../api.ts';

const FILTER_KEY: Record<string, keyof Filters> = {
  region: 'regions',
  banking_area: 'bankingAreas',
  bank_category: 'bankCategories',
  use_case: 'useCases',
};

/** Multi-select per dimension, plus search, date range and a relevance floor. */
export function FilterBar({
  taxonomy, filters, onChange, showRelevance = true,
}: {
  taxonomy: TaxonomyDimension[];
  filters: Filters;
  onChange: (f: Filters) => void;
  showRelevance?: boolean;
}) {
  const setMulti = (key: keyof Filters, el: HTMLSelectElement) => {
    const values = [...el.selectedOptions].map((o) => o.value);
    onChange({ ...filters, [key]: values });
  };

  const activeCount = taxonomy.reduce((n, d) => {
    const key = FILTER_KEY[d.dimension];
    return n + (key ? (filters[key] as string[]).length : 0);
  }, 0);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="filters">
        {taxonomy.map((dim) => {
          const key = FILTER_KEY[dim.dimension];
          if (!key) return null;
          const selected = filters[key] as string[];
          return (
            <div className="field" key={dim.dimension}>
              <label htmlFor={`f-${dim.dimension}`}>{dim.label}</label>
              <select
                id={`f-${dim.dimension}`}
                multiple
                value={selected}
                onChange={(e) => setMulti(key, e.currentTarget)}
              >
                {dim.values.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </div>
          );
        })}

        <div className="field">
          <label htmlFor="f-search">Search</label>
          <input
            id="f-search"
            type="search"
            placeholder="keyword…"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.currentTarget.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="f-from">From</label>
          <input
            id="f-from" type="date" value={filters.from}
            onChange={(e) => onChange({ ...filters, from: e.currentTarget.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="f-to">To</label>
          <input
            id="f-to" type="date" value={filters.to}
            onChange={(e) => onChange({ ...filters, to: e.currentTarget.value })}
          />
        </div>

        {showRelevance && (
          <div className="field">
            <label htmlFor="f-rel">Min relevance</label>
            <input
              id="f-rel" type="number" min={0} max={100} step={5} style={{ width: 90 }}
              value={filters.minRelevance ?? ''}
              onChange={(e) => onChange({
                ...filters,
                minRelevance: e.currentTarget.value === '' ? null : Number(e.currentTarget.value),
              })}
            />
          </div>
        )}

        <div className="field">
          <label>&nbsp;</label>
          <button
            onClick={() => onChange({
              regions: [], bankingAreas: [], bankCategories: [], useCases: [],
              publisherKinds: [], search: '', from: '', to: '', minRelevance: null,
              favoritesOnly: filters.favoritesOnly, hilDecision: filters.hilDecision,
            })}
          >
            Clear{activeCount > 0 ? ` (${activeCount})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
