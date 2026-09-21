import { useMemo, useState } from 'react';
import {
  api, emptyFilters, UNCLASSIFIED, UNCLASSIFIED_LABEL,
  type Article, type Filters, type Measures, type TaxonomyDimension,
} from '../api.ts';
import { AnalysisTable } from '../components/AnalysisTable.tsx';
import { LENS_HIDDEN } from '../components/columns.ts';
import { readPref, writePref } from '../lib/prefs.ts';
import { headlineCounts } from '../lib/summary.ts';
import { ArticleDetailPanel } from '../components/ArticleDetail.tsx';
import { FilterBar } from '../components/FilterBar.tsx';
import {
  BarChart, type BarDatum,
} from '../components/Charts.tsx';
import { useDebounced, useLensData } from '../hooks.ts';

/**
 * Where this tool's coverage actually begins.
 *
 * Not a rolling window. Daily ingestion started in July 2026 and everything
 * before it is backfill of very uneven density — 25 graded articles in July
 * against 448 in August, and single figures per month across 2024. A rolling
 * twelve months opened the Lens on eighteen months of that thinness, so the
 * trend chart's left half showed the collection ramping up rather than the
 * market moving, which is a different story told in the same shape.
 *
 * Move this date when the backfill is dense enough to be worth showing, and not
 * for any other reason.
 */
const COVERAGE_START = '2026-07-01';

/**
 * The two lenses, as one component with two scopes.
 *
 * The Swiss tab was asked for as "same layout as nr 1", and the honest way to
 * deliver that is one layout — a copied page starts identical and is different
 * within a month, and then two pages disagree about what a use case is. Only
 * the heading, the standing filter and the first chart differ, so those are
 * the three things this table holds and everything else is shared code.
 */
/**
 * The orderings the Lens offers as a one-click shortcut, and the only values
 * its remembered preference may take.
 *
 * Doubling as the allowlist for `readPref` is the point: a value left over
 * from an older release, or typed into devtools, would otherwise go straight
 * into `sort=` and the API would answer the first paint with a 400.
 */
const HEADLINE_SORTS = ['published', 'aiIntensity'] as const;
type HeadlineSort = typeof HEADLINE_SORTS[number];

const SORT_LABEL: Record<HeadlineSort, string> = {
  published: 'Newest',
  aiIntensity: 'Highest AI focus',
};

/** Per scope, because the Swiss page opens on a different question. */
const sortPrefKey = (scope: string) => `lens.sort.v1:${scope}`;

export type LensScope = 'global' | 'swiss';

interface ScopeConfig {
  title: string;
  /** Filters applied on open. The reader can change any of them afterwards. */
  standing: Partial<Filters>;
  /**
   * The first chart. Region on the global Lens; on the Swiss page every row is
   * Swiss, so the region bar would be one bar and says nothing — the useful cut
   * is which institution.
   */
  firstChart: 'region' | 'ch_nexus_evidence';
  /** Charts this page does not draw. */
  hiddenCharts: string[];
  /** Filters this page does not offer, and the ones it adds. */
  hiddenFilters: string[];
  extraFilters: { dimension: string; label: string }[];
}

const SCOPES: Record<LensScope, ScopeConfig> = {
  global: {
    title: 'Market Lens', standing: {}, firstChart: 'region',
    hiddenCharts: [], hiddenFilters: [], extraFilters: [],
  },
  swiss: {
    title: 'Agentic Swiss Banks',
    standing: {
      // Named institutions only, in the headline or the body. The third grade —
      // a Swiss paper writing about a foreign bank, or a place name with nobody
      // attached — is one click away and off by default, because it is the tier
      // that makes "Swiss AI banking news" mean nothing.
      chNexus: ['institution', 'mention'],
      // And agents at all. The page is asked one question — are the Swiss banks
      // running process steps with agents — and an article about a fraud model
      // does not answer it either way. "No agents" stays in the filter, so the
      // rest of Swiss AI is one click away rather than gone.
      agentStages: ['running', 'pilot', 'announced'],
      // Furthest along first, which is the answer the question wants at the top.
      sort: 'agentStage',
      sortDir: 'desc',
    },
    firstChart: 'ch_nexus_evidence',
    // Type of AI is fixed on this page — that is what "agentic" means — so a
    // chart and a filter for it are a control that can only say one thing.
    // Region likewise: every row here is Swiss by construction.
    hiddenCharts: ['ai_type'],
    hiddenFilters: ['region', 'ai_type'],
    extraFilters: [
      { dimension: 'agent_stage', label: 'Agents running?' },
      // The standing filter hides two things — non-agentic AI and articles with
      // no Swiss institution named — and both have to stay reachable from a
      // control, or this page breaks the rule every other filter here keeps:
      // no article is unreachable from a filter.
      { dimension: 'ch_nexus', label: 'Swiss link' },
    ],
  },
};

/**
 * The Market Lens: the global view, sliced by region, use case, type of AI and
 * L1 process. Everything here obeys the same scope rules as the lists, because
 * the facet and trend queries are built from the same builder.
 *
 * Banking area and bank category are not sliced here. They are coarse and
 * usually beside the point as market cuts; they belong to the individual
 * article, and that is where the analysis table shows them.
 *
 * Opens on 1 July 2026, where the daily collection starts. A market view needs
 * enough history to show a direction; a week of coverage shows noise and reads
 * as a news feed, which is a different tab. Earlier articles are still there —
 * "Show all dates" reaches them — they are just too sparse to open on.
 */
export function MarketLens(
  { taxonomy, scope = 'global' }:
  { taxonomy: TaxonomyDimension[]; scope?: LensScope },
) {
  const config = SCOPES[scope];
  const [filters, setFilters] = useState<Filters>(() => ({
    ...emptyFilters(),
    ...config.standing,
    from: COVERAGE_START,
    // Newest first. The page is opened most often to see what has landed, and
    // an ordering that answers "which is most about AI" cannot answer that —
    // it puts a strong August story above everything from this week. The
    // toggle above the table is one click away for the other question, and
    // whichever was chosen last is what opens next time.
    //
    // Order of precedence, and it matters: a remembered choice wins over the
    // page's standing default, because the reader made it and the default is
    // only a guess about them. So the Swiss page opens on furthest-along-first
    // until someone picks an ordering there, and on their pick afterwards.
    sort: readPref(sortPrefKey(scope), HEADLINE_SORTS) ?? config.standing.sort ?? 'published',
    sortDir: 'desc',
    // A and B only: a named institution and a concrete task, running or
    // announced. C is real AI-in-banking content with nobody named as
    // deploying it, which is context rather than a peer doing something. C, D
    // and the unread queue all stay one click away in the grade filter.
    grades: ['A'],
  }));
  const [openId, setOpenId] = useState<string | null>(null);

  const search = useDebounced(filters.search);
  const effective = useMemo(() => ({ ...filters, search }), [filters, search]);

  // The trend is still fetched — the bar charts and the counts come from the
  // same request cycle — but this page no longer draws it. Trends & Summary
  // does, with its own bucket switch, which is why 'day' is passed as a
  // constant here rather than held as state nobody can change.
  const { articles, facets, measures, total, loading, error } = useLensData(effective, 'day');

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

  /**
   * Clicking a bar toggles that value in the matching filter.
   *
   * The charts answer "where is the activity" and the next question is always
   * "show me those", which until now meant reading a label off a bar and
   * finding it again in a dropdown. Toggling rather than adding, so the same
   * bar undoes itself — a filter you can only ever add to is a trap.
   */
  const CHART_FILTER = {
    region: 'regions',
    ai_type: 'aiTypes',
    l1_process: 'l1Processes',
    // Not a taxonomy dimension — it is a column on article_scores holding the
    // institution the Swiss nexus was read from, and it comes back in the same
    // facet list as the rest so the chart needs no special case here.
    ch_nexus_evidence: 'chInstitutions',
  } as const satisfies Record<string, keyof Filters>;

  const toggleFacet = (dimension: keyof typeof CHART_FILTER) => (value: string) => {
    const field = CHART_FILTER[dimension];
    setFilters((f) => {
      const current = f[field] as string[];
      return {
        ...f,
        [field]: current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value],
      };
    });
  };

  const byDimension = (dimension: keyof typeof CHART_FILTER, limit = 12): BarDatum[] => {
    const selected = filters[CHART_FILTER[dimension]] as string[];
    return facets
      // An empty unclassified bucket is charted as a bar of length zero, which
      // tells the reader nothing and costs a row. The filter still offers it at
      // zero — an option must exist for the reader to rule the case out, but a
      // chart is a picture of what is there.
      .filter((f) => f.dimension === dimension && (f.value !== UNCLASSIFIED || f.n > 0))
      .slice(0, limit)
      .map((f) => ({
        label: labels.get(`${dimension}:${f.value}`) ?? f.value,
        value: f.n,
        key: f.value,
        active: selected.includes(f.value),
      }));
  };

  const firstCut = byDimension(config.firstChart, config.firstChart === 'region' ? 12 : 14);
  const aiTypes = byDimension('ai_type');
  const processes = byDimension('l1_process', 14);

  // One computation, shared with Trends & Summary. It used to live here, and
  // two pages each doing their own "how many are in production" is how two
  // pages come to disagree about it.
  const counts = headlineCounts(measures, facets);

  return (
    <>
      <h2 style={{ marginBottom: 4 }}>{config.title}</h2>
      {scope === 'global' ? (
        <p className="subtle" style={{ marginTop: 0, maxWidth: '70ch' }}>
          <strong>What your peers are actually doing with AI</strong> — cut by region,
          by <strong>P1–P38 process</strong>, by type of AI, and by how far along it is.
          Showing <strong>A</strong> only — a named bank doing a named task with AI,
          in the article&rsquo;s own words. <strong>B</strong> is the AI news around
          it and is one click away in the grade filter.
        </p>
      ) : (
        <p className="subtle" style={{ marginTop: 0, maxWidth: '70ch' }}>
          <strong>Where the Swiss banks stand with agents</strong> — named Swiss
          institutions only, furthest along first.
        </p>
      )}
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
              onClick={() => setFilters({ ...filters, from: COVERAGE_START })}
            >
              Back to 1 July 2026
            </button>
          </>
        )}
      </p>

      <FilterBar
        taxonomy={taxonomy} filters={filters} onChange={setFilters} facets={facets}
        hide={config.hiddenFilters} extra={config.extraFilters}
      />

      {error && <div className="banner error">{error}</div>}
      {loading && <p className="muted">Loading…</p>}

      <div className="stack">
        <div className="grid cols-2">
          <BarChart
            data={firstCut}
            title={config.firstChart === 'region' ? 'By region' : 'By Swiss institution'}
            note={config.firstChart === 'region'
              ? 'Where the reported AI activity is happening. Click a bar to filter.'
              : 'Which Swiss institution the article names, read from its own text. '
                + 'Click a bar to filter.'}
            onSelect={toggleFacet(config.firstChart)}
          />
          <BarChart
            data={processes}
            title="By L1 process"
            note={"Where in the bank's P1–P38 process landscape the use case sits. "
                  + 'Click a bar to filter.'}
            onSelect={toggleFacet('l1_process')}
          />
          {!config.hiddenCharts.includes('ai_type') && (
            <BarChart
              data={aiTypes}
              title="By type of AI"
              note={'Generative, agentic, classical machine learning or rules-based '
                    + 'automation. Click a bar to filter.'}
              onSelect={toggleFacet('ai_type')}
            />
          )}

        </div>

        <AnalysisTable
          hide={LENS_HIDDEN}
          // Counted server-side across the whole filtered view, not over the
          // 200 rows this page loaded — see headlineCounts.
          note={counts.inProduction > 0 ? ` · ${counts.inProduction} in production` : null}
          sortToggle={
            // Beside the rows it orders, so the reason the top row is what it
            // is never more than a glance away — which is the whole mitigation
            // for an ordering that is remembered between visits.
            <div className="viewswitch" role="group" aria-label="Sort">
              {HEADLINE_SORTS.map((key) => (
                <button
                  key={key}
                  type="button"
                  // Pressed state is read back out of the filters rather than
                  // held separately, so sorting by a column header instead
                  // simply leaves neither button pressed. Two controls, one
                  // state: they cannot contradict each other.
                  className={`btn-quiet${
                    filters.sort === key && filters.sortDir === 'desc' ? ' is-on' : ''}`}
                  aria-pressed={filters.sort === key && filters.sortDir === 'desc'}
                  onClick={() => {
                    writePref(sortPrefKey(scope), key);
                    setFilters((f) => ({ ...f, sort: key, sortDir: 'desc' }));
                  }}
                >
                  {SORT_LABEL[key]}
                </button>
              ))}
            </div>
          }
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
