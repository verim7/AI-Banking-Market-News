import { useEffect, useMemo, useState } from 'react';
import { api, emptyFilters, type Filters, type TaxonomyDimension } from '../api.ts';
import { FilterBar } from '../components/FilterBar.tsx';
import { BarChart, StatTile, TrendChart, type BarDatum } from '../components/Charts.tsx';
import { useDebounced } from '../hooks.ts';

/**
 * The Market Lens: the global view, sliced by region, banking area, bank
 * category and use case. Everything here obeys the same scope rules as the
 * lists, because the facet and trend queries are built from the same builder.
 */
export function MarketLens({ taxonomy }: { taxonomy: TaxonomyDimension[] }) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [facets, setFacets] = useState<{ dimension: string; value: string; n: number }[]>([]);
  const [trend, setTrend] = useState<{ day: string; n: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const search = useDebounced(filters.search);
  const effective = useMemo(() => ({ ...filters, search }), [filters, search]);
  const key = JSON.stringify(effective);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      api.facets(effective),
      api.trend(effective),
      api.articles(effective, { limit: 1, offset: 0 }),
    ])
      .then(([f, t, a]) => {
        if (cancelled) return;
        setFacets(f.facets);
        setTrend(t.trend);
        setTotal(a.total);
      })
      .catch((err) => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of taxonomy) for (const v of d.values) map.set(`${d.dimension}:${v.value}`, v.label);
    return map;
  }, [taxonomy]);

  const byDimension = (dimension: string, limit = 12): BarDatum[] =>
    facets
      .filter((f) => f.dimension === dimension)
      .slice(0, limit)
      .map((f) => ({ label: labels.get(`${dimension}:${f.value}`) ?? f.value, value: f.n }));

  const regions = byDimension('region');
  const useCases = byDimension('use_case');
  const areas = byDimension('banking_area');
  const categories = byDimension('bank_category');

  const last7 = trend.slice(-7).reduce((n, d) => n + d.n, 0);
  const topRegion = regions[0];
  const topUseCase = useCases[0];

  return (
    <>
      <FilterBar taxonomy={taxonomy} filters={filters} onChange={setFilters} />

      {error && <div className="banner error">{error}</div>}
      {loading && <p className="muted">Loading…</p>}

      <div className="stack">
        <div className="grid cols-4">
          <StatTile label="Articles in view" value={total} note="matching current filters" />
          <StatTile label="Last 7 days" value={last7} note="newly published" />
          <StatTile
            label="Top region"
            value={topRegion?.label ?? '—'}
            note={topRegion ? `${topRegion.value} articles` : 'no data'}
          />
          <StatTile
            label="Top use case"
            value={topUseCase?.label ?? '—'}
            note={topUseCase ? `${topUseCase.value} articles` : 'no data'}
          />
        </div>

        <TrendChart
          data={trend}
          title="Coverage over time"
          note="Articles per day matching the current filters."
        />

        <div className="grid cols-2">
          <BarChart
            data={regions}
            title="By region"
            note="Where the reported AI activity is happening."
          />
          <BarChart
            data={useCases}
            title="By AI use case"
            note="What the AI is actually being used for."
          />
          <BarChart
            data={areas}
            title="By banking area"
            note="Which part of the bank is involved."
          />
          <BarChart
            data={categories}
            title="By bank category"
            note="What kind of institution is reported."
          />
        </div>

        <details className="card">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            Table view of these figures
          </summary>
          <p className="subtle" style={{ marginTop: 8 }}>
            The same counts as the charts above, for reading exactly or copying out.
          </p>
          <table>
            <thead>
              <tr><th>Dimension</th><th>Value</th><th className="num">Articles</th></tr>
            </thead>
            <tbody>
              {facets.map((f) => (
                <tr key={`${f.dimension}:${f.value}`}>
                  <td>{taxonomy.find((d) => d.dimension === f.dimension)?.label ?? f.dimension}</td>
                  <td>{labels.get(`${f.dimension}:${f.value}`) ?? f.value}</td>
                  <td className="num">{f.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </>
  );
}
