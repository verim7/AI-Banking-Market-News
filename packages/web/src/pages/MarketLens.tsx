import { useEffect, useMemo, useState } from 'react';
import {
  api, emptyFilters, UNCLASSIFIED, UNCLASSIFIED_LABEL,
  type Article, type Filters, type Measures, type TaxonomyDimension,
} from '../api.ts';
import { AnalysisTable } from '../components/AnalysisTable.tsx';
import { ArticleDetailPanel } from '../components/ArticleDetail.tsx';
import { FilterBar } from '../components/FilterBar.tsx';
import { BarChart, StatTile, TrendChart, type BarDatum } from '../components/Charts.tsx';
import { useDebounced } from '../hooks.ts';

/** ISO date this many months before today. */
function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * The Market Lens: the global view, sliced by region, use case, type of AI and
 * L1 process. Everything here obeys the same scope rules as the lists, because
 * the facet and trend queries are built from the same builder.
 *
 * Banking area and bank category are not sliced here. They are coarse and
 * usually beside the point as market cuts; they belong to the individual
 * article, and that is where the analysis table shows them.
 *
 * Opens on the last twelve months. A market view needs enough history to show
 * a direction; a week of coverage shows noise and reads as a news feed, which
 * is a different tab.
 */
export function MarketLens({ taxonomy }: { taxonomy: TaxonomyDimension[] }) {
  const [filters, setFilters] = useState<Filters>(() => ({
    // Opens on the most promising use cases rather than the most recent or
    // the most "relevant": completeness first, then AI focus. An article with
    // no AI category and no described use case is not actionable however high
    // it scores, so it cannot reach the top.
    ...emptyFilters(), from: monthsAgo(12), sort: 'promise', sortDir: 'desc',
  }));
  const [articles, setArticles] = useState<Article[]>([]);
  const [facets, setFacets] = useState<{ dimension: string; value: string; n: number }[]>([]);
  const [trend, setTrend] = useState<{ day: string; n: number }[]>([]);
  const [measures, setMeasures] = useState<Measures | null>(null);
  const [total, setTotal] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
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
      api.articles(effective, { limit: 200, offset: 0 }),
    ])
      .then(([f, t, a]) => {
        if (cancelled) return;
        setFacets(f.facets);
        setMeasures(f.measures);
        setTrend(t.trend);
        setTotal(a.total);
        setArticles(a.articles);
      })
      .catch((err) => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of taxonomy) {
      for (const v of d.values) map.set(`${d.dimension}:${v.value}`, v.label);
      // The unclassified bucket is not a taxonomy value, so it has no label of
      // its own. Without this the charts and the figures table print the raw
      // sentinel at the reader.
      map.set(`${d.dimension}:${UNCLASSIFIED}`, UNCLASSIFIED_LABEL);
    }
    return map;
  }, [taxonomy]);

  const byDimension = (dimension: string, limit = 12): BarDatum[] =>
    facets
      // An empty unclassified bucket is charted as a bar of length zero, which
      // tells the reader nothing and costs a row. The filter still offers it at
      // zero — an option must exist for the reader to rule the case out, but a
      // chart is a picture of what is there.
      .filter((f) => f.dimension === dimension && (f.value !== UNCLASSIFIED || f.n > 0))
      .slice(0, limit)
      .map((f) => ({ label: labels.get(`${dimension}:${f.value}`) ?? f.value, value: f.n }));

  const regions = byDimension('region');
  const useCases = byDimension('use_case');
  const aiTypes = byDimension('ai_type');
  const processes = byDimension('l1_process', 14);

  // From the facets, not from the loaded articles. The page loads 200 rows, so
  // counting maturity from `articles` reported "in production among the top
  // 200" under a label that said "in production" — wrong by exactly the amount
  // nobody could see. The maturity facet is already computed across the whole
  // filtered view, server-side.
  const maturityCount = (value: string) =>
    facets.find((f) => f.dimension === 'maturity' && f.value === value)?.n ?? 0;

  const inProduction = maturityCount('in_production');
  const piloting = maturityCount('pilot');

  const windowNote = filters.from
    ? `published since ${filters.from}`
    : 'all dates';

  return (
    <>
      <h2 style={{ marginBottom: 4 }}>Market Lens</h2>
      <p className="subtle" style={{ marginTop: 0, maxWidth: '70ch' }}>
        <strong>Understanding.</strong> Twelve months of AI-in-banking coverage by
        default, so the picture shows a direction rather than a week of noise.
        Only articles where AI is genuinely the subject are counted — sanctions
        notices, capital rules and results announcements are filtered out before
        they reach here.
      </p>
      <p className="subtle" style={{ marginTop: 0, maxWidth: '70ch' }}>
        {filters.from ? (
          <>
            Showing articles published since <strong>{filters.from}</strong>. The
            Archive holds everything ever collected, so its total is larger —
            that is the date window, not a different set of articles.{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => setFilters({ ...filters, from: '' })}
            >
              Show all dates
            </button>
          </>
        ) : (
          <>
            Showing <strong>all dates</strong>, the same range as the Archive.{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => setFilters({ ...filters, from: monthsAgo(12) })}
            >
              Back to the last 12 months
            </button>
          </>
        )}
      </p>

      <FilterBar
        taxonomy={taxonomy} filters={filters} onChange={setFilters} facets={facets}
      />

      {error && <div className="banner error">{error}</div>}
      {loading && <p className="muted">Loading…</p>}

      <div className="stack">
        <div className="grid cols-4">
          <StatTile
            label="AI articles in view"
            value={total}
            // The window, spelled out. The Lens opens on twelve months and the
            // Archive opens on everything, so the two tabs legitimately report
            // different totals for the same database — and a bare count with no
            // window beside it reads as a contradiction rather than a setting.
            note={windowNote}
          />
          <StatTile
            label="In production"
            value={inProduction}
            note="stated as live or rolled out"
          />
          <StatTile
            label="Pilot or testing"
            value={piloting}
            note="trials, proofs of concept"
          />
          <StatTile
            // Replaces a "Top region" tile: the By region chart directly below
            // already names the leading region, whereas how many use cases were
            // actually found was stated nowhere. Confirmed means the article
            // describes the use case in its own words and the type of AI is
            // known — the same test that decides what tops the table below.
            label="AI use cases identified"
            value={measures?.confirmedUseCases ?? 0}
            note={`confirmed · +${measures?.possibleUseCases ?? 0} possible`}
          />
        </div>

        <TrendChart
          data={trend}
          title="Coverage over time"
          note="AI-in-banking articles per month. Only articles where AI is the subject are counted."
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
            data={aiTypes}
            title="By type of AI"
            note="Generative, agentic, classical machine learning or rules-based automation."
          />
          <BarChart
            data={processes}
            title="By L1 process"
            note="Where in the bank's process landscape the use case sits."
          />
        </div>

        <AnalysisTable
          articles={articles}
          total={total}
          labels={labels}
          filters={filters}
          onOpen={setOpenId}
          onSort={(sort) => setFilters((f) => ({
            ...f,
            sort,
            // Same column again reverses; a new column starts descending,
            // which is what "top of the list" means for a score.
            sortDir: f.sort === sort && f.sortDir === 'desc' ? 'asc' : 'desc',
          }))}
          onFilterProcess={(value) => setFilters((f) => ({
            ...f,
            l1Processes: f.l1Processes.includes(value)
              ? f.l1Processes
              : [...f.l1Processes, value],
          }))}
        />

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

      <ArticleDetailPanel
        articleId={openId}
        labels={labels}
        onClose={() => setOpenId(null)}
        onFilterProcess={(value) => setFilters((f) => ({
          ...f,
          l1Processes: f.l1Processes.includes(value) ? f.l1Processes : [...f.l1Processes, value],
        }))}
      />
    </>
  );
}
