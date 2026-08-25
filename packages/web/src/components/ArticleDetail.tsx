import { useEffect, useRef, useState } from 'react';
import { api, type ArticleDetail as Detail } from '../api.ts';

/**
 * One article, read in place.
 *
 * A drawer rather than a modal, and rather than a link away. The table stays
 * visible behind it, so a reader can work down the list — open, read, close,
 * open the next — without losing their position. That is the actual task: the
 * Lens exists to be triaged, and a modal that blanks the page turns triage into
 * a sequence of round trips.
 *
 * The summary comes first because it is the thing being asked for. Everything
 * below it is the evidence for the labels above it, so a reader can disagree
 * with the machine using the article's own words rather than taking the
 * classification on trust.
 */

const STAGE_LABEL: Record<string, string> = {
  in_production: 'In production',
  pilot: 'Pilot or testing',
  announced: 'Announced',
  research: 'Study',
  unknown: 'Not stated',
};

export function ArticleDetailPanel({
  articleId, labels, onClose, onFilterProcess, onDecide,
}: {
  articleId: string | null;
  labels: Map<string, string>;
  onClose: () => void;
  onFilterProcess?: (value: string) => void;
  /**
   * Record a review decision. Supplied wherever the reader may make one, which
   * is the only way to reach a decision from the table view — the card list has
   * its own control, and before this the table had none at all.
   */
  onDecide?: (id: string, decision: string) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!articleId) { setDetail(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.article(articleId)
      .then((r) => { if (!cancelled) setDetail(r.article); })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load this article.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [articleId]);

  useEffect(() => {
    if (!articleId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // Move focus into the panel so a keyboard reader is not left behind in the
    // table, reading a row whose detail is now on screen.
    panel.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [articleId, onClose]);

  if (!articleId) return null;

  const label = (dimension: string, value: string) =>
    labels.get(`${dimension}:${value}`) ?? value;
  const tagValues = (dimension: string) =>
    (detail?.tags ?? []).filter((t) => t.dimension === dimension).map((t) => t.value);

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        className="drawer"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={detail?.title ?? 'Article'}
      >
        <header className="drawer-head">
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
          {detail && (
            <>
              <h3>{detail.title}</h3>
              <p className="subtle">
                {detail.source}
                {detail.publishedAt ? ` · ${detail.publishedAt.slice(0, 10)}` : ''}
              </p>
            </>
          )}
        </header>

        <div className="drawer-body">
          {loading && <p className="muted">Loading…</p>}

          {error && <div className="banner error">{error}</div>}

          {detail && onDecide && (
            <section className="drawer-section">
              <h4>Review decision</h4>
              <div className="decide-row">
                {(['relevant', 'not_relevant', 'undecided'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`btn-quiet${detail.hilDecision === d ? ' is-on' : ''}`}
                    aria-pressed={detail.hilDecision === d}
                    onClick={() => {
                      onDecide(detail.id, d);
                      setDetail({ ...detail, hilDecision: d });
                    }}
                  >
                    {d === 'not_relevant' ? 'Not relevant' : d === 'relevant' ? 'Relevant' : 'Undecided'}
                  </button>
                ))}
              </div>
              <p className="subtle" style={{ marginTop: 6 }}>
                Saved to the Review Queue.
              </p>
            </section>
          )}

          {detail?.review && (
            <section className="drawer-section">
              <h4>Reviewed use case</h4>
              <p className="review-headline">
                <span className={`grade grade-${detail.review.grade}`}>{detail.review.grade}</span>
                <strong>{detail.review.headline}</strong>
              </p>
              <dl className="drawer-facts">
                {detail.review.actor && (<><dt>Institution</dt><dd>{detail.review.actor}</dd></>)}
                {detail.review.task && (<><dt>What the AI does</dt><dd>{detail.review.task}</dd></>)}
                {detail.review.technique && (
                  <><dt>Technique</dt><dd>{detail.review.technique}</dd></>)}
                {detail.review.outcome && (
                  <><dt>Stated outcome</dt><dd>{detail.review.outcome}</dd></>)}
                <dt>Confidence</dt><dd>{detail.review.confidence}</dd>
              </dl>
              {detail.review.evidence && (
                <p className="subtle" style={{ marginTop: 8 }}>
                  {/* The line above is composed; this is what it was composed
                      from. Shown together, always. */}
                  Read from: <q>{detail.review.evidence}</q>
                </p>
              )}
            </section>
          )}

          {detail && (
            <>
              <section className="drawer-section">
                <h4>Summary</h4>
                {detail.summaryExtract ? (
                  <>
                    <p className="drawer-summary">{detail.summaryExtract}</p>
                    {/* Said plainly, because a reader deciding whether a bank
                        really deployed something needs to know whether these
                        are the article's words or a machine's. They are the
                        article's. */}
                    <p className="subtle tiny">
                      Sentences selected from the article. Nothing here is written by this tool.
                    </p>
                  </>
                ) : (
                  <p className="subtle">
                    No summary — the article text could not be read. Publishers behind a
                    paywall or a consent wall return nothing to an automated request.
                  </p>
                )}
              </section>

              <section className="drawer-section">
                <h4>What the classifier read</h4>
                <dl className="drawer-facts">
                  <dt>AI focus</dt>
                  <dd>
                    <span className="meter-value">{Math.round(detail.aiIntensity)}</span> / 100
                  </dd>

                  <dt>Type of AI</dt>
                  <dd>
                    {tagValues('ai_type').length === 0
                      ? <span className="subtle">Not identified</span>
                      : tagValues('ai_type').map((t) => (
                          <span key={t} className="chip">{label('ai_type', t)}</span>))}
                  </dd>

                  <dt>L1 process</dt>
                  <dd>
                    {tagValues('l1_process').length === 0
                      ? <span className="subtle">Not identified</span>
                      : tagValues('l1_process').map((p) => (
                          <button
                            key={p} type="button" className="chip chip-action"
                            onClick={() => { onFilterProcess?.(p); onClose(); }}
                            title={`Show only ${label('l1_process', p)}`}
                          >{label('l1_process', p)}</button>))}
                  </dd>

                  <dt>Stage</dt>
                  <dd>
                    {STAGE_LABEL[detail.maturity] ?? detail.maturity}
                    {detail.maturityEvidence && (
                      <span className="subtle evidence">“{detail.maturityEvidence}”</span>)}
                  </dd>

                  <dt>Use case</dt>
                  <dd>
                    {detail.useCaseEvidence
                      ? <q>{detail.useCaseEvidence}</q>
                      : <span className="subtle">Not described in the article</span>}
                  </dd>
                </dl>
              </section>

              {detail.excerpt && (
                <section className="drawer-section">
                  <h4>The article</h4>
                  <div className="drawer-extract">{detail.excerpt}</div>
                  <p className="subtle tiny">
                    Extract of the published page, stored when the article was collected.
                  </p>
                </section>
              )}

              <a className="btn-quiet drawer-link"
                 href={detail.url} target="_blank" rel="noopener noreferrer">
                Open the original ↗
              </a>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
