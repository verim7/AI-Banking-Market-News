import type { Article } from '../api.ts';

/**
 * The article-level analysis behind the Lens.
 *
 * The charts answer "how much"; this answers "which ones, and how sure are we".
 * Every judgement the classifier made is shown next to the article, including
 * the phrase it read the deployment stage from — a maturity label nobody can
 * check is a claim, not evidence, and this table is meant to be argued with.
 */

const MATURITY: Record<Article['maturity'], { label: string; cls: string; hint: string }> = {
  in_production: {
    label: 'In production', cls: 'st-good',
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
    label: 'Not stated', cls: 'st-muted',
    hint: 'The article gives no usable signal about how far along it is.',
  },
};

/** Series colour per AI type, in the fixed order the tokens define. */
const AI_TYPE_SERIES: Record<string, string> = {
  generative_ai: 'var(--series-1)',
  agentic_ai: 'var(--series-2)',
  machine_learning: 'var(--series-3)',
  traditional_automation: 'var(--series-4)',
};

function tagValues(a: Article, dimension: string): string[] {
  return a.tags.filter((t) => t.dimension === dimension).map((t) => t.value);
}

/** A meter, not a bar chart: one row, one value, read at a glance. */
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

export function AnalysisTable({
  articles, total, labels,
}: {
  articles: Article[];
  total: number;
  labels: Map<string, string>;
}) {
  const label = (dimension: string, value: string) =>
    labels.get(`${dimension}:${value}`) ?? value;

  return (
    <section className="card">
      <h3 style={{ margin: '0 0 4px' }}>Every AI article in this view</h3>
      <p className="subtle" style={{ marginTop: 0 }}>
        {articles.length < total
          ? `The ${articles.length} most relevant of ${total} matching articles.`
          : `All ${total} matching articles.`}{' '}
        <strong>AI focus</strong> is how central AI is to the piece, separate from
        how relevant the source is. <strong>Stage</strong> is read from the
        article's own wording — hover it to see the exact phrase.
      </p>

      <div className="table-scroll">
        <table className="analysis">
          <thead>
            <tr>
              <th>Article</th>
              <th className="num">AI focus</th>
              <th>Type of AI</th>
              <th>L1 process</th>
              <th>Stage</th>
              <th>Region</th>
              <th className="num">Published</th>
            </tr>
          </thead>
          <tbody>
            {articles.map((a) => {
              const m = MATURITY[a.maturity] ?? MATURITY.unknown;
              const types = tagValues(a, 'ai_type');
              const procs = tagValues(a, 'l1_process');
              const regions = tagValues(a, 'region');

              return (
                <tr key={a.id}>
                  <td className="cell-title">
                    <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a>
                    <span className="subtle src">{a.source}</span>
                  </td>

                  <td className="num"><IntensityMeter value={a.aiIntensity} /></td>

                  <td>
                    {types.length === 0
                      ? <span className="subtle">—</span>
                      : types.map((t) => (
                          <span key={t} className="chip">
                            <span
                              className="swatch"
                              style={{ background: AI_TYPE_SERIES[t] ?? 'var(--border-strong)' }}
                            />
                            {label('ai_type', t)}
                          </span>
                        ))}
                  </td>

                  <td>
                    {procs.length === 0
                      ? <span className="subtle">—</span>
                      : procs.slice(0, 2).map((p) => (
                          <span key={p} className="chip">{label('l1_process', p)}</span>
                        ))}
                    {procs.length > 2 && (
                      <span className="subtle" title={procs.slice(2).map((p) => label('l1_process', p)).join(', ')}>
                        +{procs.length - 2}
                      </span>
                    )}
                  </td>

                  <td>
                    {/* Status is never colour alone: the chip carries its label,
                        and the evidence phrase is one hover away. */}
                    <span
                      className={`status ${m.cls}`}
                      title={a.maturityEvidence
                        ? `${m.hint}\n\nRead from: "${a.maturityEvidence}"`
                        : m.hint}
                    >
                      {m.label}
                    </span>
                    {a.maturityEvidence && (
                      <span className="subtle evidence">“{a.maturityEvidence}”</span>
                    )}
                  </td>

                  <td>
                    {regions.length === 0
                      ? <span className="subtle">—</span>
                      : <span className="chip">{label('region', regions[0]!)}</span>}
                  </td>

                  <td className="num nowrap">
                    {a.publishedAt ? a.publishedAt.slice(0, 10) : '—'}
                  </td>
                </tr>
              );
            })}

            {articles.length === 0 && (
              <tr>
                <td colSpan={7} className="subtle" style={{ padding: 16 }}>
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
