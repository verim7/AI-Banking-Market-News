import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import type { Article, Filters, SortKey } from '../api.ts';

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

// Banking area and bank category live here and nowhere else. They are facts
// about a row rather than useful ways to slice the market, so they were taken
// out of the filters and the charts — but taken out of the app entirely they
// would have left the export carrying two columns the page never showed.
//
// Neither is sortable: both are multi-valued tags, and a sort key that silently
// ordered by whichever value happened to come first would be a lie in a table
// whose whole point is being checkable.
const COLUMNS: { key: SortKey | null; label: string; className?: string }[] = [
  { key: 'title', label: 'Article' },
  { key: 'aiIntensity', label: 'AI focus', className: 'num' },
  { key: null, label: 'AI use case in this article' },
  { key: null, label: 'Type' },
  { key: null, label: 'L1 process' },
  { key: 'maturity', label: 'Stage' },
  { key: 'published', label: 'Date', className: 'num' },
  // Last, and deliberately: the table is wider than most screens, so column
  // order decides what has to be scrolled to. These two are supporting detail —
  // which is the same reason they are no longer filters — and pushing Stage and
  // Date off the edge to promote them would have been an odd way to say so.
  { key: null, label: 'Banking area' },
  { key: null, label: 'Bank category' },
];

const tagValues = (a: Article, dimension: string): string[] =>
  a.tags.filter((t) => t.dimension === dimension).map((t) => t.value);

const WEEK_MS = 7 * 86_400_000;

/**
 * Published in the last seven days.
 *
 * This replaces the "This Week" tab. A whole tab to express a date filter meant
 * recency could only be seen by leaving the page you were reading — and once
 * there, everything on it was recent, so the marker carried no information.
 * Marking the rows in place says which of these use cases are new while you are
 * looking at the twelve-month picture.
 *
 * Spelled out rather than left as a dot. A coloured dot needs a legend or a
 * hover to mean anything, and the whole point is that it should be readable at
 * a glance while scanning the table.
 *
 * Falls back to false when the date is missing rather than guessing from the
 * fetch date: an article we happened to collect today may be two years old.
 */
function isThisWeek(publishedAt: string | null): boolean {
  if (!publishedAt) return false;
  const when = Date.parse(publishedAt);
  if (Number.isNaN(when)) return false;
  return Date.now() - when < WEEK_MS;
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

/**
 * One use case, however many outlets reported it.
 *
 * `groupKey` comes from the API — the same bank and the same L1 process. Rows
 * arrive already sorted, so the first member of a group is its best row and
 * leads it; the rest fold underneath and stay one click away. Nothing is
 * hidden, which is what makes a coarse key safe here: an over-merge is a fold
 * the reader can open, not a row they never see.
 *
 * A row with no key is its own group, always. That is the common case — no
 * institution in the headline, or no process — and it must never collapse
 * with another.
 */
interface Group {
  lead: Article;
  members: Article[];
}

export function groupArticles(articles: Article[]): Group[] {
  const groups: Group[] = [];
  const at = new Map<string, number>();

  for (const a of articles) {
    const key = a.groupKey;
    if (!key) { groups.push({ lead: a, members: [] }); continue; }

    const seen = at.get(key);
    if (seen === undefined) {
      at.set(key, groups.length);
      groups.push({ lead: a, members: [] });
    } else {
      groups[seen]!.members.push(a);
    }
  }

  return groups;
}

export function AnalysisTable({
  articles, total, labels, filters, onSort, onFilterProcess, onOpen,
}: {
  articles: Article[];
  total: number;
  labels: Map<string, string>;
  filters: Filters;
  onSort?: (key: SortKey) => void;
  onFilterProcess?: (value: string) => void;
  /** Open the drill-down for this article. */
  onOpen?: (id: string) => void;
}) {
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

  const row = (g: Group, a: Article, isMember = false) => {
    const stage = STAGE[a.maturity] ?? STAGE.unknown;
    const types = tagValues(a, 'ai_type');
    const procs = tagValues(a, 'l1_process');

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
          <td className="cell-title">
            {isThisWeek(a.publishedAt) && (
              <span className="fresh" title="Published in the last 7 days">
                <span className="fresh-dot" aria-hidden="true" />
                This week published
              </span>
            )}
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

          <td className="num"><IntensityMeter value={a.aiIntensity} /></td>

          <td className="cell-usecase">
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

          <td>
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

          <td>
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

          <td>
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

          <td className="num nowrap">
            {a.publishedAt ? a.publishedAt.slice(0, 10) : '—'}
          </td>

          <td>
            {tagValues(a, 'banking_area').length === 0
              ? <span className="subtle">—</span>
              : tagValues(a, 'banking_area').map((v) => (
                  <span key={v} className="chip">{label('banking_area', v)}</span>
                ))}
          </td>

          <td>
            {tagValues(a, 'bank_category').length === 0
              ? <span className="subtle">—</span>
              : tagValues(a, 'bank_category').map((v) => (
                  <span key={v} className="chip">{label('bank_category', v)}</span>
                ))}
          </td>
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
          </p>
        </div>
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
              {COLUMNS.map((col) => (
                <th key={col.label} className={col.className}
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
                <td colSpan={COLUMNS.length} className="subtle" style={{ padding: 16 }}>
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
