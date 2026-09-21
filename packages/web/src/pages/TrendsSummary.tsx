import { useMemo, useState } from 'react';
import {
  emptyFilters, UNCLASSIFIED_LABEL, type Filters, type TaxonomyDimension,
} from '../api.ts';
import { FilterBar } from '../components/FilterBar.tsx';
import { StatTile, TrendChart, fillGaps, type TrendBucket } from '../components/Charts.tsx';
import { useDebounced, useLensData } from '../hooks.ts';
import { COVERAGE_START } from '../lib/coverage.ts';
import { COVERAGE_CAVEAT, headlineCounts, summaryLines, windowNote } from '../lib/summary.ts';

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
  { taxonomy, onOpenLens }: { taxonomy: TaxonomyDimension[]; onOpenLens?: () => void },
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

  // No article list: this page renders none, and asking for 200 rows it will
  // never draw is a request paid for on every filter change.
  const { facets, trend, measures, loading, error } =
    useLensData(effective, bucket, { withArticles: false });

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of taxonomy) {
      for (const v of d.values) map.set(`${d.dimension}:${v.value}`, v.label);
      map.set(`${d.dimension}:__none__`, UNCLASSIFIED_LABEL);
    }
    return map;
  }, [taxonomy]);

  const counts = headlineCounts(measures, facets);
  const lines = summaryLines(counts, facets, labels);

  return (
    <>
      <h2 style={{ marginBottom: 4 }}>Trends &amp; Summary</h2>
      <p className="subtle" style={{ marginTop: 0, maxWidth: '70ch' }}>
        Where banks and financial services have got to with AI, as far as the
        reporting shows.{' '}
        {onOpenLens && (
          <button type="button" className="link-button" onClick={onOpenLens}>
            Open the Market Lens
          </button>
        )}
      </p>

      <FilterBar
        taxonomy={taxonomy} facets={facets} filters={filters} onChange={setFilters}
      />

      {error && <div className="banner error">{error}</div>}
      {loading && <p className="muted">Loading…</p>}

      <div className="stack">
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Summary</h3>
          {/* First, not in a footnote. Every number below counts news
              coverage, and a page titled "where banks have got to" that does
              not say so is claiming a survey nobody carried out. */}
          <p className="subtle" style={{ marginTop: 0 }}>{COVERAGE_CAVEAT}</p>
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
            note={windowNote(filters.from)}
          />
          <StatTile
            label="In production"
            value={counts.inProduction}
            note="stated as live or rolled out"
          />
          <StatTile
            label="Pilot or testing"
            value={counts.piloting}
            note="trials, proofs of concept"
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
