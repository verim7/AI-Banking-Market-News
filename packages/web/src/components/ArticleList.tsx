import type { Article, TaxonomyDimension } from '../api.ts';

function scoreClass(n: number): string {
  if (n >= 60) return 'score high';
  if (n >= 35) return 'score mid';
  return 'score low';
}

function formatDate(iso: string | null): string {
  if (!iso) return 'undated';
  return iso.slice(0, 10);
}

/** Turn taxonomy values into readable labels for the chips on each article. */
export function makeLabeller(taxonomy: TaxonomyDimension[]) {
  const map = new Map<string, string>();
  for (const dim of taxonomy) {
    for (const v of dim.values) map.set(`${dim.dimension}:${v.value}`, v.label);
  }
  return (dimension: string, value: string) => map.get(`${dimension}:${value}`) ?? value;
}

export function ArticleRow({
  article, label, onDecide, selectable, selected, onSelect, canReview,
}: {
  article: Article;
  label: (dimension: string, value: string) => string;
  onDecide?: (id: string, decision: string) => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string, on: boolean) => void;
  canReview: boolean;
}) {
  const why = article.ruleHits
    .filter((h) => h.weight > 0)
    .map((h) => `${h.rule}: ${h.term} (+${h.weight})`)
    .join('\n');

  return (
    <article className="article">
      <div className="row">
        {selectable && (
          <input
            type="checkbox"
            checked={!!selected}
            aria-label={`Select ${article.title}`}
            onChange={(e) => onSelect?.(article.id, e.currentTarget.checked)}
          />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>
            <a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a>
          </h3>

          {article.summary && <p>{article.summary}</p>}

          <div className="chips" style={{ marginBottom: 8 }}>
            {article.tags.map((t) => (
              <span key={`${t.dimension}:${t.value}`} className={t.dimension === 'use_case' ? 'chip accent' : 'chip'}>
                {label(t.dimension, t.value)}
              </span>
            ))}
          </div>

          <div className="meta">
            <span
              className={scoreClass(article.relevance)}
              title={why || 'No scoring detail recorded.'}
            >
              {Math.round(article.relevance)}
            </span>
            <span>{article.source}</span>
            <span>{formatDate(article.publishedAt)}</span>
            <span className="muted">{article.publisherKind}</span>
            {article.enrichedBy === 'claude' && <span className="chip">AI summary</span>}

            <span style={{ flex: 1 }} />

            {canReview && onDecide && (
              <select
                aria-label={`Decision for ${article.title}`}
                value={article.hilDecision}
                onChange={(e) => onDecide(article.id, e.currentTarget.value)}
              >
                <option value="undecided">Undecided</option>
                <option value="relevant">Relevant</option>
                <option value="not_relevant">Not relevant</option>
              </select>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export function ArticleList({
  articles, total, label, loading, onDecide,
  selectable, selectedIds, onSelect, canReview, onLoadMore,
}: {
  articles: Article[];
  total: number;
  label: (dimension: string, value: string) => string;
  loading: boolean;
  onDecide?: (id: string, decision: string) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (id: string, on: boolean) => void;
  canReview: boolean;
  onLoadMore?: () => void;
}) {
  if (loading && articles.length === 0) return <p className="muted">Loading…</p>;

  if (articles.length === 0) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          Nothing matches these filters. Try clearing them, or lowering the
          minimum relevance.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="subtle">
        Showing {articles.length} of {total}
      </p>

      {articles.map((a) => (
        <ArticleRow
          key={a.id}
          article={a}
          label={label}
          onDecide={onDecide}
          selectable={selectable}
          selected={selectedIds?.has(a.id)}
          onSelect={onSelect}
          canReview={canReview}
        />
      ))}

      {articles.length < total && onLoadMore && (
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <button onClick={onLoadMore} disabled={loading}>
            {loading ? 'Loading…' : `Load more (${total - articles.length} remaining)`}
          </button>
        </div>
      )}
    </>
  );
}
