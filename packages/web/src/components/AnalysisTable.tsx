import { useMemo, useState, type ReactNode } from 'react';
import * as XLSX from 'xlsx';
import type { Article, Filters, SortKey } from '../api.ts';
import { visibleColumns, type ColumnId } from './columns.ts';
// The fold lives in lib/ now, so the executive board on Trends & Summary
// counts one use case exactly the way this table does.
import { groupArticles, type Group } from '../lib/group-articles.ts';

/**
 * The article-level analysis behind the Lens.
 *
 * The charts answer "how much"; this answers "which ones, and how sure are we".
 * Every judgement the classifier made is shown next to the article, including
 * the sentence it read each one from — a label nobody can check is a claim, not
 * evidence, and this table is meant to be argued with.
 *
 * Sorting is server-side rather than a client sort of the visible page: sorting
 * only what happened to load would silently answer "highest AI focus on this
 * page" while looking like it answered "highest AI focus".
 */

const STAGE: Record<Article['maturity'], { label: string; cls: string; hint: string }> = {
  in_production: {
    label: 'Production', cls: 'st-good',
    hint: 'The article states the system is live, rolled out or generally available.',
  },
  pilot: {
    label: 'Pilot', cls: 'st-warn',
    hint: 'Described as a pilot, trial, proof of concept or test.',
  },
  announced: {
    label: 'Announced', cls: 'st-info',
    hint: 'An intention or a plan; no evidence it is running yet.',
  },
  research: {
    label: 'Study', cls: 'st-muted',
    hint: 'A study, survey or report rather than a deployment.',
  },
  unknown: {
    label: '—', cls: 'st-muted',
    hint: 'The article gives no usable signal about how far along it is.',
  },
};

/** The rubric, as tooltips, so a letter on a row is never unexplained. */
const GRADE_HINT: Record<string, string> = {
  A: 'AI use case: a named institution and a named banking task the AI performs, both in the '
   + 'quoted sentence. How far along it is is in the Stage column, not here.',
  B: 'AI market news: real AI-in-banking content with no named task — strategy and capability '
   + 'announcements, research units, adoption programmes, vendor launches, regulation, surveys.',
  C: 'Retired. Every C was re-graded as B once "generic" and "market news" turned out to be one bucket.',
  D: 'Not relevant: share-price pieces, funding rounds, opinion.',
};

const AI_TYPE_SERIES: Record<string, string> = {
  generative_ai: 'var(--series-1)',
  agentic_ai: 'var(--series-2)',
  machine_learning: 'var(--series-3)',
  traditional_automation: 'var(--series-4)',
};

/**
 * The four answers, and what each one is allowed to claim.
 *
 * "Live" is the only one that says a process step is running on agents, so it
 * is the only one that gets the strong colour. "No agents" is a real answer
 * rather than a blank: a reader scanning this column needs to see that most
 * banking AI is not agentic, which a row of dashes would hide.
 */
const AGENT_STAGE: Record<string, { label: string; className: string; title: string }> = {
  running: { label: 'Live', className: 'agent agent-running',
             title: 'Agentic AI, and the article says it is live or rolled out' },
  pilot: { label: 'Piloting', className: 'agent agent-pilot',
           title: 'Agentic AI, in a trial or proof of concept' },
  announced: { label: 'Announced', className: 'agent agent-announced',
               title: 'Agentic AI, with nothing said about it running anywhere' },
  none: { label: 'No agents', className: 'agent agent-none',
          title: 'Not agentic — classical machine learning, generative drafting '
                 + 'or rule-based automation' },
};

const tagValues = (a: Article, dimension: string): string[] =>
  a.tags.filter((t) => t.dimension === dimension).map((t) => t.value);

const WEEK_MS = 7 * 86_400_000;

/**
 * How recently this was published, in the two bands worth marking.
 *
 * This replaces the "This Week" tab. A whole tab to express a date filter meant
 * recency could only be seen by leaving the page you were reading — and once
 * there, everything on it was recent, so the marker carried no information.
 * Marking the rows in place says which of these use cases are new while you are
 * looking at the whole picture.
 *
 * Two bands rather than one, because "nothing new this week" and "nothing new
 * this month" are different facts and a single marker cannot tell them apart:
 * an empty table of markers looks the same either way. The second band gives
 * the first one a scale to be read against.
 *
 * Both are spelled out rather than left as coloured dots. A dot needs a legend
 * or a hover to mean anything, and the point is that it should be readable at a
 * glance while scanning the table. The colour then separates the two bands for
 * anyone scanning faster than they read — and never carries the meaning alone,
 * which would lose it for a reader who cannot tell the two colours apart.
 *
 * Falls back to null when the date is missing rather than guessing from the
 * fetch date: an article we happened to collect today may be two years old.
 */
type Freshness = { className: string; title: string; label: string };

function freshness(publishedAt: string | null): Freshness | null {
  if (!publishedAt) return null;
  const when = Date.parse(publishedAt);
  if (Number.isNaN(when)) return null;
  const age = Date.now() - when;
  if (age < 0) return null;
  if (age < WEEK_MS) {
    return { className: 'fresh', title: 'Published in the last 7 days',
             label: 'This week' };
  }
  if (age < 2 * WEEK_MS) {
    return { className: 'fresh last-week', title: 'Published 7 to 14 days ago',
             label: 'Last week' };
  }
  return null;
}

function IntensityMeter({ value }: { value: number }) {
  return (
    <div className="meter" title={`${Math.round(value)} / 100 — how central AI is to this article`}>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </div>
      <span className="meter-value">{Math.round(value)}</span>
    </div>
  );
}

/** One flat row per article, shared by the CSV and the spreadsheet. */
/**
 * The sheet, one row per article.
 *
 * Two date columns beyond the publication date, because a spreadsheet outlives
 * the session that produced it and someone always has to ask how old it is:
 * `Collected` is when this pipeline pulled that article in, and `Exported` is
 * when the file was downloaded. The gap between them is the staleness, and it
 * is per row rather than a footnote so a filtered sheet still carries it.
 */
function exportRows(
  articles: Article[], label: (d: string, v: string) => string, exportedAt: string,
) {
  return articles.map((a) => ({
    // First in the export as it is first in the table, so a spreadsheet opens
    // on the same answer the page does.
    'Agents running?': AGENT_STAGE[a.agentStage]?.label ?? '',
    Title: a.title,
    Source: a.source,
    Published: a.publishedAt ? a.publishedAt.slice(0, 10) : '',
    Collected: a.fetchedAt ? a.fetchedAt.slice(0, 10) : '',
    Exported: exportedAt,
    Grade: a.review?.grade ?? '',
    'Reviewed use case': a.review?.headline ?? '',
    'AI focus': Math.round(a.aiIntensity),
    Relevance: Math.round(a.relevance),
    'AI use case (quoted from the article)': a.useCaseEvidence ?? '',
    'Type of AI': tagValues(a, 'ai_type').map((v) => label('ai_type', v)).join('; '),
    'L1 process': tagValues(a, 'l1_process').map((v) => label('l1_process', v)).join('; '),
    Region: tagValues(a, 'region').map((v) => label('region', v)).join('; '),
    'Banking area': tagValues(a, 'banking_area').map((v) => label('banking_area', v)).join('; '),
    'Bank category': tagValues(a, 'bank_category').map((v) => label('bank_category', v)).join('; '),
    Stage: STAGE[a.maturity]?.label ?? '',
    'Stage read from': a.maturityEvidence ?? '',
    'Swiss institution': a.chNexusEvidence ?? '',
    URL: a.url,
  }));
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Re-exported: this is where callers expect to find it, and `export … from`
// alone would not give the component below a local binding to call.
export { groupArticles };
export type { Group };

export function AnalysisTable({
  articles, total, labels, filters, onSort, onFilterProcess, onOpen, hide, sortToggle, note,
}: {
  articles: Article[];
  total: number;
  labels: Map<string, string>;
  filters: Filters;
  onSort?: (key: SortKey) => void;
  onFilterProcess?: (value: string) => void;
  /** Open the drill-down for this article. */
  onOpen?: (id: string) => void;
  /**
   * Columns this page leaves out. The Archive shows all ten; the Market Lens
   * shows seven. The export is not affected — it carries every field whatever
   * the page displays, which is the whole reason a hidden column is not a
   * deleted one.
   */
  hide?: readonly ColumnId[];
  /**
   * A page's own shortcut for the one or two orderings it considers headline
   * ones, rendered beside the export buttons.
   *
   * Passed in rather than built here so the table stays ignorant of which
   * sorts matter to whom: the Lens cares about newest and most-AI, the Archive
   * cares about neither and passes nothing. The column headers remain the
   * complete way to sort, and this shortcut reads its pressed state back out
   * of `filters` so the two can never disagree.
   */
  sortToggle?: ReactNode;
  /**
   * A page's own headline numbers, appended to the count line.
   *
   * The Lens used to carry four stat tiles above the table and now carries
   * none — they moved to Trends & Summary, which is the right home for them
   * and the wrong place to have to go for "how many are in production". This
   * keeps the sentence people quote on the page people read.
   */
  note?: ReactNode;
}) {
  const visible = useMemo(() => visibleColumns(hide), [hide]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const groups = useMemo(() => groupArticles(articles), [articles]);
  const folded = groups.reduce((n, g) => n + g.members.length, 0);

  const label = (dimension: string, value: string) =>
    labels.get(`${dimension}:${value}`) ?? value;

  const stamp = new Date().toISOString().slice(0, 10);

  const doExport = (kind: 'csv' | 'xlsx') => {
    setBusy(true);
    try {
      // Minute precision: two exports on the same day are a normal thing to
      // want to tell apart, and a bare date cannot.
      const exportedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const rows = exportRows(articles, label, exportedAt);
      const sheet = XLSX.utils.json_to_sheet(rows);
      if (kind === 'csv') {
        download(new Blob([XLSX.utils.sheet_to_csv(sheet)], { type: 'text/csv;charset=utf-8' }),
                 `market-lens-${stamp}.csv`);
      } else {
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, sheet, 'AI in banking');
        const out = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
        download(new Blob([out], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }), `market-lens-${stamp}.xlsx`);
      }
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const arrow = (key: SortKey | null) => {
    if (!key || filters.sort !== key) return null;
    return <span className="sort-arrow" aria-hidden="true">{filters.sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  /**
   * One row, built as a map of cell-by-column-id rather than a fixed sequence
   * of <td>s.
   *
   * It used to be a sequence, and the header was already a map over COLUMNS —
   * so the two lists agreed only by counting. Reordering the array moved every
   * header and left every cell where it was, and nothing would have failed
   * except the reader's trust in the table. Keyed by id, the same list decides
   * both, and a column that a page hides takes its cells with it.
   */
  const row = (g: Group<Article>, a: Article, isMember = false) => {
    const stage = STAGE[a.maturity] ?? STAGE.unknown;
    const types = tagValues(a, 'ai_type');
    const procs = tagValues(a, 'l1_process');
    const f = freshness(a.publishedAt);

    const cells: Record<ColumnId, ReactNode> = {
      // Date and recency in one cell, because they are one fact. The date is
      // exact and the badge is what it means — "2026-08-28" does not tell a
      // scanning reader whether that is this week, and doing that subtraction
      // forty times down a page is work the table should have done.
      published: (
        <td key="published" className="cell-date">
          <span className="date">{a.publishedAt ? a.publishedAt.slice(0, 10) : '—'}</span>
          {f && (
            <span className={f.className} title={f.title}>
              <span className="fresh-dot" aria-hidden="true" />
              {f.label}
            </span>
          )}
        </td>
      ),

      title: (
        <td key="title" className="cell-title">
          <a href={a.url} target="_blank" rel="noopener noreferrer"
             onClick={(e) => e.stopPropagation()}>{a.title}</a>
          <span className="subtle src">
            {a.source}
            {tagValues(a, 'region').slice(0, 1).map((r) => (
              <span key={r}> · {label('region', r)}</span>
            ))}
          </span>

          {!isMember && g.members.length > 0 && (
            // The count is the point as much as the fold: eight outlets on
            // one rollout is a fact about the story, and it was previously
            // spent as eight rows saying the same thing.
            <button
              type="button"
              className="group-toggle"
              aria-expanded={open.has(g.lead.id)}
              onClick={(e) => { e.stopPropagation(); toggle(g.lead.id); }}
            >
              {open.has(g.lead.id) ? '▾' : '▸'}{' '}
              {g.members.length} more {g.members.length === 1 ? 'report' : 'reports'}
              {' '}of this use case
            </button>
          )}
        </td>
      ),

      use_case: (
        <td key="use_case" className="cell-usecase">
          {a.review ? (
            <>
              {/* Written by reading the article, so it says so. The
                  quote below is what it was read from — the written
                  line must never travel without it. */}
              <span className={`grade grade-${a.review.grade}`}
                    title={GRADE_HINT[a.review.grade]}>
                {a.review.grade}
              </span>
              <strong className="uc-headline">{a.review.headline}</strong>
              {a.review.outcome && (
                <span className="uc-outcome">{a.review.outcome}</span>
              )}
              {a.review.evidence && (
                <q className="uc-evidence">{a.review.evidence}</q>
              )}
            </>
          ) : a.useCaseEvidence ? (
            <q>{a.useCaseEvidence}</q>
          ) : (
            <span className="subtle">Not described in the article</span>
          )}
        </td>
      ),

      ai_intensity: (
        <td key="ai_intensity" className="num"><IntensityMeter value={a.aiIntensity} /></td>
      ),

      agent_stage: (
        <td key="agent_stage" className="cell-agent">
          {(() => {
            const st = AGENT_STAGE[a.agentStage] ?? AGENT_STAGE['none']!;
            return <span className={st.className} title={st.title}>{st.label}</span>;
          })()}
        </td>
      ),

      ai_type: (
        <td key="ai_type">
          {types.length === 0
            ? <span className="subtle">—</span>
            : types.map((t) => (
                <span key={t} className="chip">
                  <span className="swatch"
                        style={{ background: AI_TYPE_SERIES[t] ?? 'var(--border-strong)' }} />
                  {label('ai_type', t)}
                </span>
              ))}
        </td>
      ),

      l1_process: (
        <td key="l1_process">
          {procs.length === 0
            ? <span className="subtle">—</span>
            : procs.slice(0, 2).map((p) => (
                // Clicking narrows the whole view to that process, so
                // the description and the taxonomy are connected
                // rather than merely adjacent.
                <button
                  key={p} type="button" className="chip chip-action"
                  title={`Show only ${label('l1_process', p)}`}
                  onClick={(e) => { e.stopPropagation(); onFilterProcess?.(p); }}
                >
                  {label('l1_process', p)}
                </button>
              ))}
          {procs.length > 2 && (
            <span className="subtle"
                  title={procs.slice(2).map((p) => label('l1_process', p)).join(', ')}>
              +{procs.length - 2}
            </span>
          )}
        </td>
      ),

      maturity: (
        <td key="maturity">
          <span className={`status ${stage.cls}`}
                title={a.maturityEvidence
                  ? `${stage.hint}\n\nRead from: "${a.maturityEvidence}"`
                  : stage.hint}>
            {stage.label}
          </span>
          {a.maturityEvidence && (
            <span className="subtle evidence">“{a.maturityEvidence}”</span>
          )}
        </td>
      ),

      banking_area: (
        <td key="banking_area">
          {tagValues(a, 'banking_area').length === 0
            ? <span className="subtle">—</span>
            : tagValues(a, 'banking_area').map((v) => (
                <span key={v} className="chip">{label('banking_area', v)}</span>
              ))}
        </td>
      ),

      bank_category: (
        <td key="bank_category">
          {tagValues(a, 'bank_category').length === 0
            ? <span className="subtle">—</span>
            : tagValues(a, 'bank_category').map((v) => (
                <span key={v} className="chip">{label('bank_category', v)}</span>
              ))}
        </td>
      ),
    };

    return (
      <tr
        key={a.id}
        className={[onOpen ? 'row-openable' : '', isMember ? 'row-member' : '']
          .filter(Boolean).join(' ') || undefined}
        tabIndex={onOpen ? 0 : undefined}
        // A row is a control now, so it has to answer the keyboard.
        // Without this the drill-down is reachable only with a mouse
        // and the table becomes less usable than the link it replaced.
        onClick={onOpen ? () => onOpen(a.id) : undefined}
        onKeyDown={onOpen ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpen(a.id);
            }
        } : undefined}>
        {visible.map((c) => cells[c.id])}
      </tr>
    );
  };

  return (
    <section className="card">
      <div className="table-head">
        <div>
          <h3>Every AI article in this view</h3>
          {/* The prose that used to sit here explained the grades, the sort
              order and the quoting rule, and was longer than most of the table
              it introduced. What is left is the one thing a reader cannot work
              out by looking: how much of the result set is on screen, and how
              much of what is on screen has been folded together. */}
          <p className="subtle">
            {articles.length < total
              ? `Top ${articles.length} of ${total}`
              : `${total} articles`}
            {/* The same figure the "AI use cases identified" tile shows, counted
                the same way, so the two reconcile on sight instead of looking
                like a discrepancy. It can differ from the tile once the grade
                filter is widened: the tile counts reviewed use cases, this
                counts whatever is on screen. */}
            {folded > 0 && ` · ${groups.length} use cases`}
            {note}
          </p>
        </div>
        {sortToggle}
        <div className="table-actions">
          <button type="button" className="btn-quiet" disabled={busy || articles.length === 0}
                  onClick={() => doExport('csv')}>Export CSV</button>
          <button type="button" className="btn-quiet" disabled={busy || articles.length === 0}
                  onClick={() => doExport('xlsx')}>Export Excel</button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="analysis">
          <thead>
            <tr>
              {visible.map((col) => (
                <th key={col.id} className={col.className}
                    aria-sort={col.key && filters.sort === col.key
                      ? (filters.sortDir === 'asc' ? 'ascending' : 'descending')
                      : undefined}>
                  {col.key && onSort ? (
                    <button type="button" className="th-sort" onClick={() => onSort(col.key!)}>
                      {col.label}{arrow(col.key)}
                    </button>
                  ) : col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((g) => [
              row(g, g.lead),
              ...(open.has(g.lead.id) ? g.members.map((m) => row(g, m, true)) : []),
            ])}

            {articles.length === 0 && (
              <tr>
                <td colSpan={visible.length} className="subtle" style={{ padding: 16 }}>
                  Nothing matches these filters. Widen the date range, or clear a filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
