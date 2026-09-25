import { useMemo, useState } from 'react';
import {
  emptyFilters, type Filters, type TaxonomyDimension,
} from '../api.ts';
import { FilterBar, filterLabels, SearchField } from '../components/FilterBar.tsx';
import { StatTile, TrendChart, fillGaps, type TrendBucket } from '../components/Charts.tsx';
import { useDebounced, useLensData } from '../hooks.ts';
import { COVERAGE_START } from '../lib/coverage.ts';
import {
  COVERAGE_CAVEAT, headlineCounts, summaryLines, tileWindowNote,
} from '../lib/summary.ts';
import { groupArticles, type Group } from '../lib/group-articles.ts';
import {
  bandsFor, boardFor, boardMessage, unstatedCount, type Reviewed,
} from '../lib/institutions.ts';
import { InstitutionMark } from '../components/InstitutionMark.tsx';
import { FilterChips } from '../components/FilterChips.tsx';

/**
 * Where the market is, in numbers, above the shape of the coverage over time.
 *
 * Split out of the Market Lens, which had grown four tiles and a full-width
 * time chart above its first article row — about 1,200px of context before any
 * content. Those are worth having and they are not worth scrolling past forty
 * times a week, so they have a page, and the Lens opens on the use cases.
 *
 * It seeds the *identical* default filters to the Lens on purpose. The two
 * pages report the same corpus, and a tile here that disagreed with the table
 * footer there would be read as a bug in the data rather than as two different
 * date windows.
 */
export function TrendsSummary(
  { taxonomy }: { taxonomy: TaxonomyDimension[] },
) {
  const [filters, setFilters] = useState<Filters>(() => ({
    ...emptyFilters(),
    from: COVERAGE_START,
    grades: ['A'],
  }));
  // Days by default: the question this chart is asked most is what moved since
  // yesterday, and a monthly bar cannot answer it.
  const [bucket, setBucket] = useState<TrendBucket>('day');

  const search = useDebounced(filters.search);
  const effective = useMemo(() => ({ ...filters, search }), [filters, search]);

  // The article list is back, and it is what the board is built from: every
  // name on it is a reviewed actor and every line under it a reviewed task,
  // which exist per article and not in any aggregate.
  const { articles, facets, trend, measures, loading, error } =
    useLensData(effective, bucket);

  // The same map the Lens and the filter bar read. This page had its own,
  // built from the taxonomy alone, so the chip row printed "grade: A" where
  // the Lens printed "Use case grade: A · AI use case" — one value, two names,
  // two tabs.
  const labels = useMemo(() => filterLabels(taxonomy), [taxonomy]);

  const counts = headlineCounts(measures, facets);
  const lines = summaryLines(counts, facets, labels);

  // Folded with the same function the Market Lens table uses, so one use case
  // reported by four outlets is one card here and one row there.
  const groups = useMemo<Group<Reviewed>[]>(() => groupArticles(articles), [articles]);
  const stages = boardFor(groups);
  const bands = bandsFor(stages);
  const shown = stages.reduce((n, st) => n + st.entries.length, 0);
  const unstated = unstatedCount(groups);

  return (
    <>
      {/* For screen readers and the outline only. The tab above names the page,
          and the line under it that pointed back to the Market Lens pointed at
          a tab one row higher on the same screen. */}
      <h2 className="sr-only">Trends &amp; Summary</h2>

      {/* The same slim bar the Market Lens uses, for the same reason: eleven
          dropdowns above the board is a screen of context before any content,
          which is the complaint this whole redesign started from. */}
      <div className="lens-bar">
        <SearchField
          value={filters.search}
          onChange={(v) => setFilters((f) => ({ ...f, search: v }))}
        />
        <details className="morefilters">
          <summary>More filters</summary>
          <FilterBar
            taxonomy={taxonomy} facets={facets} filters={filters} onChange={setFilters}
            showSearch={false}
          />
        </details>
      </div>

      <FilterChips filters={filters} labels={labels} onChange={setFilters} />

      {error && <div className="banner error">{error}</div>}

      {/* Dimmed in place while a filter change is fetched, as on the Market
          Lens — a "Loading…" line here pushed the whole page down and back up
          on every change. */}
      <div className={`stack${loading && articles.length > 0 ? ' is-loading' : ''}`}
           aria-busy={loading || undefined}>
        <section className="card board">
          {/* The caveat sits directly above the bank names, not in a footnote.
              A board of named institutions is exactly where "this counts what
              was reported, not what was built" has to be visible. */}
          <p className="board-key">{boardMessage(stages)}</p>
          <p className="subtle" style={{ marginTop: 0, maxWidth: '84ch' }}>
            {COVERAGE_CAVEAT}
          </p>

          {/* The three rungs, as column heads. The entries sit under them in
              bands, largest institutions first, so the top row is Tier 1
              whatever each stage holds — ranked within each column alone, one
              stage's Tier 1 would sit level with another's Tier 3. */}
          <div className="board-stages">
            {stages.map((stage, i) => (
              <section className="board-stage" key={stage.key}>
                <h3>
                  {stage.label}
                  <span className="board-count">{stage.entries.length}</span>
                </h3>
                <p className="subtle board-stage-note">{stage.note}</p>
                {i < stages.length - 1 && (
                  <span className="board-arrow" aria-hidden="true">&rarr;</span>
                )}
              </section>
            ))}
          </div>

          {bands.length === 0 ? (
            <p className="muted board-empty">Nothing here in this view.</p>
          ) : (
            <div className="board-bands">
              {bands.map((band) => (
                <section
                  className="board-band" key={band.key} data-band={band.key}
                  aria-labelledby={`band-${band.key}`}
                >
                  <div className="board-band-head">
                    <h4 id={`band-${band.key}`}>
                      {band.label}
                      <span className="board-band-count">{band.count}</span>
                    </h4>
                    <p className="subtle board-band-note">{band.note}</p>
                  </div>
                  <div className="board-cells">
                    {band.cells.map((cell, i) => (
                      <div
                        className={`board-cell${cell.entries.length === 0 ? ' is-empty' : ''}`}
                        data-stage={cell.stage} key={cell.stage}
                      >
                        {/* Said on a phone, where the cells stack and the column
                            heads are a screen away; on a desktop the column
                            says it, and this is for screen readers only. */}
                        <p className="board-cell-label">{stages[i]!.label}</p>
                        {cell.entries.length > 0 && (
                          <ul className="board-list">
                            {cell.entries.map((e) => (
                              <li key={e.id}>
                                <InstitutionMark
                                  slug={e.slug} monogram={e.monogram} actor={e.actor}
                                  basis={e.tier.institution?.basis}
                                />
                                <div className="board-entry">
                                  <a href={e.url} target="_blank" rel="noreferrer noopener">
                                    {e.actor}
                                  </a>
                                  {/* The reviewer's own words for what this
                                      institution is doing, not the headline. */}
                                  <span className="board-task">{e.task ?? e.headline}</span>
                                  {e.reports > 1 && (
                                    <span className="board-reports">
                                      {e.reports} reports
                                    </span>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {/* What the board is not showing, stated rather than left to be
              discovered. The page loads at most 200 articles, and a use case
              whose stage nobody wrote down is not a rung on this ladder. */}
          <p className="subtle board-foot">
            {shown} reviewed use cases with a named institution, folded from the
            {' '}{articles.length} most recent articles in this view.
            {unstated > 0
              && ` ${unstated} more were graded A but state no stage, so they are not placed.`}
            {' '}Every name and task here was written by a reviewer reading the
            article; open one to read the source.
          </p>
        </section>

        <section className="card">
          <h3 className="summary-head">Summary</h3>
          <ul className="summary-lines">
            {lines.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>

        <div className="grid cols-4">
          <StatTile
            label="AI articles in view"
            value={counts.total}
            // The window, spelled out. This page and the Archive legitimately
            // report different totals for the same database — a bare count
            // with no window beside it reads as a contradiction.
            note={tileWindowNote(filters.from)}
          />
          <StatTile
            label="In production"
            value={counts.inProduction}
            // Articles, and said so. The board above counts use cases, and a
            // bare "4" under a board whose production column says "2" reads as
            // a contradiction rather than as a different unit.
            note="articles stated as live or rolled out"
          />
          <StatTile
            label="Pilot or testing"
            value={counts.piloting}
            note="articles on trials or proofs of concept"
          />
          <StatTile
            // Reviewed grades where they exist, the rule heuristic where they
            // do not — and the note says which, because the two are not the
            // same kind of number. A reviewed A means someone read the article
            // and found a named institution running a named task; a rules
            // "confirmed" only means the words co-occurred.
            label="AI use cases identified"
            value={counts.useCases}
            note={counts.reviewed > 0
              ? `from ${counts.reports} reports · ${counts.deployed} deployed`
              : `unreviewed · from ${counts.reports} reports`}
          />
        </div>

        <TrendChart
          data={fillGaps(trend, bucket)}
          bucket={bucket}
          onBucket={setBucket}
          title="Coverage over time"
          note={
            `AI-in-banking articles per ${bucket}. Periods with no coverage are `
            + 'shown as zero rather than skipped, so a flat line means quiet and '
            + 'not missing. Only articles where AI is the subject are counted.'
          }
        />
      </div>
    </>
  );
}
