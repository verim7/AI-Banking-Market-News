import { useMemo, useState } from 'react';
import { api, type Me, type TaxonomyDimension } from '../api.ts';
import { FilterBar } from '../components/FilterBar.tsx';
import { ArticleList, makeLabeller } from '../components/ArticleList.tsx';
import { useArticles } from '../hooks.ts';

type Queue = 'undecided' | 'relevant' | 'not_relevant';

const QUEUES: { key: Queue; label: string }[] = [
  { key: 'undecided', label: 'To review' },
  { key: 'relevant', label: 'Relevant' },
  { key: 'not_relevant', label: 'Not relevant' },
];

/**
 * Human-in-the-loop triage: work the queue, mark what matters, export it for
 * Market Lens. Export goes through the same scoped query as the list, so it can
 * never contain something the reviewer could not see.
 */
export function HilChecker({ taxonomy, me }: { taxonomy: TaxonomyDimension[]; me: Me }) {
  const [queue, setQueue] = useState<Queue>('undecided');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const state = useArticles({ hilDecision: queue });
  const label = useMemo(() => makeLabeller(taxonomy), [taxonomy]);

  const canReview = me.permissions.includes('hil.review');
  const canExport = me.permissions.includes('hil.export');

  const select = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });

  const selectAllVisible = () =>
    setSelected(new Set(state.articles.map((a) => a.id)));

  const changeQueue = (next: Queue) => {
    setQueue(next);
    setSelected(new Set());
    setNotice(null);
  };

  const bulkDecide = async (decision: Queue) => {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.decideBulk([...selected], decision);
      setNotice(`Marked ${res.updated} article${res.updated === 1 ? '' : 's'} as ${decision.replace('_', ' ')}.`);
      setSelected(new Set());
      state.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Save a Blob without a download link, which the browser sandbox may block. */
  const save = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const day = new Date().toISOString().slice(0, 10);

  const exportCsv = async () => {
    setBusy(true);
    setError(null);
    try {
      const csv = await api.exportCsv([...selected], state.effective);
      save(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `market-lens-${day}.csv`);
      setNotice(`Exported ${selected.size > 0 ? selected.size : state.total} rows as CSV.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * XLSX is built in the browser rather than the Worker. That keeps Worker CPU
   * near zero, which is what keeps this inside the free plan's 10 ms budget.
   * The library is code-split so it only downloads when someone exports.
   */
  const exportXlsx = async () => {
    setBusy(true);
    setError(null);
    try {
      const [csv, XLSX] = await Promise.all([
        api.exportCsv([...selected], state.effective),
        import('xlsx'),
      ]);
      // Strip the BOM the CSV endpoint adds for Excel; the parser does not want it.
      const workbook = XLSX.read(csv.replace(/^﻿/, ''), { type: 'string', raw: true });
      workbook.SheetNames[0] = 'Market Lens';
      workbook.Sheets['Market Lens'] = workbook.Sheets[Object.keys(workbook.Sheets)[0]!]!;
      const out = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      save(
        new Blob([out], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `market-lens-${day}.xlsx`,
      );
      setNotice(`Exported ${selected.size > 0 ? selected.size : state.total} rows as Excel.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>Review Queue</h2>
      <p className="subtle" style={{ maxWidth: '70ch' }}>
        <strong>Turning collected news into a reviewed use-case list.</strong>{' '}
        Everything here has already passed the machine filter for <em>is this
        really about AI in banking</em>. The remaining question is a human one:{' '}
        <strong>is this a use case worth putting in front of a bank.</strong> Work
        through <em>To review</em>, open a row to read the article and the
        evidence behind each judgement, and mark it <em>Relevant</em> or{' '}
        <em>Not relevant</em>. Decisions save immediately, including the ones you
        make in the Archive, and they are yours — a colleague works their own
        queue, not this one.
      </p>
      <p className="subtle" style={{ maxWidth: '70ch' }}>
        <strong>What you keep becomes an extract.</strong> The <em>Relevant</em>{' '}
        list is your accepted set; export it as CSV or Excel and every row carries
        the article, the use case in the article&rsquo;s own words, the P1–P38
        process, the type of AI, the maturity, the region and the source. That
        file is the working input for a bank&rsquo;s own AI use-case inventory — a
        shortlist of what peers have genuinely deployed, mapped onto the same
        process landscape the bank runs, ready to assess for internal adoption.
      </p>

      <div className="toolbar">
        {QUEUES.map((q) => (
          <button
            key={q.key}
            aria-current={queue === q.key ? 'true' : undefined}
            className={queue === q.key ? 'primary' : ''}
            onClick={() => changeQueue(q.key)}
          >
            {q.label}
          </button>
        ))}

        <span className="spacer" />

        <span className="muted">
          {selected.size > 0 ? `${selected.size} selected` : 'nothing selected'}
        </span>
        <button onClick={selectAllVisible} disabled={state.articles.length === 0}>
          Select all shown
        </button>
        <button onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
          Clear
        </button>
      </div>

      <div className="toolbar">
        {canReview && (
          <>
            <button onClick={() => bulkDecide('relevant')} disabled={busy || selected.size === 0}>
              Mark relevant
            </button>
            <button onClick={() => bulkDecide('not_relevant')} disabled={busy || selected.size === 0}>
              Mark not relevant
            </button>
            <button onClick={() => bulkDecide('undecided')} disabled={busy || selected.size === 0}>
              Reset to undecided
            </button>
          </>
        )}

        <span className="spacer" />

        {canExport && (
          <>
            <button className="primary" onClick={exportCsv} disabled={busy}>
              Export CSV
            </button>
            <button className="primary" onClick={exportXlsx} disabled={busy}>
              Export Excel
            </button>
          </>
        )}
      </div>

      <p className="hint">
        Export sends your current selection. With nothing selected it exports
        everything matching the filters below, up to 500 rows.
      </p>

      <FilterBar
        taxonomy={taxonomy} filters={state.filters}
        onChange={state.setFilters} facets={state.facets}
      />

      {notice && <div className="banner info">{notice}</div>}
      {(error || state.error) && <div className="banner error">{error ?? state.error}</div>}

      <ArticleList
        articles={state.articles}
        total={state.total}
        label={label}
        loading={state.loading}
        onDecide={canReview ? state.decide : undefined}
        selectable
        selectedIds={selected}
        onSelect={select}
        canReview={canReview}
        onLoadMore={state.loadMore}
      />
    </>
  );
}
