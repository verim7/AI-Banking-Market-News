import { useMemo, useState } from 'react';
import {
  emptyFilters, UNCLASSIFIED,
  type Filters, type TaxonomyDimension,
} from '../api.ts';
import { AnalysisTable } from '../components/AnalysisTable.tsx';
import { LENS_HIDDEN, LENS_SHOWN } from '../components/columns.ts';
import { COVERAGE_START } from '../lib/coverage.ts';
import { readPref, writePref } from '../lib/prefs.ts';
import { headlineCounts } from '../lib/summary.ts';
import { ArticleDetailPanel } from '../components/ArticleDetail.tsx';
import { DIMENSION_LABELS, FilterBar, filterLabels, SearchField } from '../components/FilterBar.tsx';
import { FilterChips } from '../components/FilterChips.tsx';
import {
  BarChart, type BarDatum,
} from '../components/Charts.tsx';
import { useDebounced, useLensData, useMediaQuery } from '../hooks.ts';

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

/**
 * Whether the breakdown pane is open, remembered.
 *
 * Not per scope: it is a statement about the reader's screen and how much of
 * it they want the table to have, and that does not change between two tabs
 * showing the same table.
 */
const PANE_PREF = 'lens.pane.v1';
const PANE_STATES = ['open', 'closed'] as const;

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
      { dimension: 'agent_stage', label: DIMENSION_LABELS.agent_stage },
      // The standing filter hides two things — non-agentic AI and articles with
      // no Swiss institution named — and both have to stay reachable from a
      // control, or this page breaks the rule every other filter here keeps:
      // no article is unreachable from a filter.
      { dimension: 'ch_nexus', label: DIMENSION_LABELS.ch_nexus },
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

  /**
   * Beside the table, or below it.
   *
   * Two trees rather than one styled two ways: a visually collapsed aside is
   * still a column of charts between the table and the end of the document for
   * anyone reading with a keyboard or a screen reader. 1180px is where the
   * table and a 320px pane both fit; below it the breakdowns are a closed
   * disclosure under the rows, because the whole complaint was context before
   * content and a pane above the table on a phone would be exactly that again.
   */
  const wide = useMediaQuery('(min-width: 1180px)');
  const [paneOpen, setPaneOpen] = useState(
    () => readPref(PANE_PREF, PANE_STATES) !== 'closed',
  );

  const search = useDebounced(filters.search);
  const effective = useMemo(() => ({ ...filters, search }), [filters, search]);

  // The trend is still fetched — the bar charts and the counts come from the
  // same request cycle — but this page no longer draws it. Trends & Summary
  // does, with its own bucket switch, which is why 'day' is passed as a
  // constant here rather than held as state nobody can change.
  const { articles, facets, measures, total, loading, error } = useLensData(effective, 'day');

  // The same map the filter bar and the chip row read, so a bar, a dropdown
  // and a chip cannot call one value three things.
  const labels = useMemo(() => filterLabels(taxonomy), [taxonomy]);

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

  /**
   * The three cuts, as one value rendered in one of two places.
   *
   * Unchanged from when they sat above the table: `onSelect` and CHART_FILTER
   * already did the click-to-filter, so moving them beside the rows they
   * filter needed no new behaviour at all.
   */
  const breakdowns = (
    <>
      <BarChart
        data={firstCut}
        title={config.firstChart === 'region' ? 'By region' : 'By Swiss institution'}
        onSelect={toggleFacet(config.firstChart)}
      />
      <BarChart
        data={processes}
        title="By L1 process (P1–P38)"
        onSelect={toggleFacet('l1_process')}
      />
      {!config.hiddenCharts.includes('ai_type') && (
        <BarChart
          data={aiTypes}
          title="By type of AI"
          onSelect={toggleFacet('ai_type')}
        />
      )}
    </>
  );

  return (
    <>
      {/* Kept for screen readers and the document outline, hidden from sight:
          the tab directly above already names the page, and the line that
          used to follow it described the page to a reader who was already
          on it. The chips below say what this view is filtered to, which is
          the part that changes. */}
      <h2 className="sr-only">{config.title}</h2>

      <div className="lens-bar">
        {/* Out of the disclosure on purpose: searching is the one filter people
            reach for without knowing which dimension they want, and putting it
            behind a click would be putting the fast path behind the slow one. */}
        <SearchField
          value={filters.search}
          onChange={(v) => setFilters((f) => ({ ...f, search: v }))}
        />
        {/* Native <details>, so the inputs stay in the DOM when it is closed
            and the keyboard behaviour is free. The dropdowns are kept rather
            than replaced by the chart bars: the L1 chart shows the top 14 of
            some 38 processes, so bars alone would leave the tail unreachable
            from any control. Bars are the fast path; these are the complete
            one. */}
        <details className="morefilters">
          <summary>More filters</summary>
          <FilterBar
            taxonomy={taxonomy} filters={filters} onChange={setFilters} facets={facets}
            hide={config.hiddenFilters} extra={config.extraFilters} showSearch={false}
          />
        </details>
      </div>

      <FilterChips
        filters={filters}
        labels={labels}
        onChange={setFilters}
        note={
          // Only while it is true. The old paragraph said this unconditionally,
          // including on a view whose grade filter had been cleared.
          filters.grades.length === 1 && filters.grades[0] === 'A'
            // Plain words, not grade letters. The chip beside this already
            // says what A means; the only thing left to say is where the rest
            // went.
            ? 'Market news and unread articles are one click away in More filters.'
            : null
        }
      />

      {error && <div className="banner error">{error}</div>}

      <div className={`lens-layout${wide && !paneOpen ? ' pane-closed' : ''}`}>
        <div className="lens-main">
          <AnalysisTable
            hide={LENS_HIDDEN}
            show={LENS_SHOWN}
            title={null}
            loading={loading}
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

        {wide ? (
          <aside className="lens-pane" aria-label="Breakdowns">
            {/* A table that fits is worth more than a chart that is always
                there, on a laptop where the two compete for the same 1400px.
                Remembered, because that is a fact about the screen. */}
            <button
              type="button"
              className="btn-quiet pane-toggle"
              aria-expanded={paneOpen}
              onClick={() => {
                writePref(PANE_PREF, paneOpen ? 'closed' : 'open');
                setPaneOpen(!paneOpen);
              }}
            >
              {paneOpen ? 'Hide breakdowns' : 'Breakdowns'}
            </button>
            {paneOpen && (
              <div className="lens-pane-body">
                {/* Said once for all three, where each chart used to say it
                    in its own caption. */}
                <p className="subtle pane-hint">Click a bar to filter the list.</p>
                {breakdowns}
              </div>
            )}
          </aside>
        ) : (
          <details className="lens-breakdowns">
            <summary>Breakdowns &amp; filters</summary>
            <div className="lens-pane-body">
              <p className="subtle pane-hint">Tap a bar to filter the list.</p>
              {breakdowns}
            </div>
          </details>
        )}
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
