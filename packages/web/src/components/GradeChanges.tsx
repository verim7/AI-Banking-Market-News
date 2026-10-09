import { useEffect, useState } from 'react';
import { api, type GradeChange } from '../api.ts';

/**
 * What article text changed: every re-grade made once an article had text from
 * the editor's browser or the headless Chromium, last 30 days. Changes first;
 * the re-checks that kept their grade are folded away. This is what the
 * browser trial is judged on (docs/local-browser-routine.md).
 */

const FROM: Record<GradeChange['textFrom'], string> = {
  'local-browser': 'Your browser',
  chromium: 'Chromium on GitHub',
};

const day = (d: string) => new Date(`${d}T00:00:00Z`)
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function Rows({ rows }: { rows: GradeChange[] }) {
  return (
    <div className="table-scroll">
      <table className="grade-changes-table">
        <thead>
          <tr><th scope="col">Re-graded</th><th scope="col">Article</th><th scope="col">Grade</th><th scope="col">Text from</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.id}-${r.passOn}`}>
              <td className="nowrap">{day(r.passOn)}</td>
              <td>
                <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>
                {r.grade === 'A' && r.actor && <div className="subtle">{r.actor}: {r.task}</div>}
              </td>
              <td className="nowrap">
                {r.grade === r.previousGrade ? `${r.grade}, kept` : <strong>{r.previousGrade} → {r.grade}</strong>}
              </td>
              <td className="nowrap">{FROM[r.textFrom]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GradeChanges() {
  const [rows, setRows] = useState<GradeChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.gradeChanges().then((r) => setRows(r.changes)).catch((e: Error) => { setError(e.message); setRows([]); });
  }, []);
  if (rows === null) return null;

  const changed = rows.filter((r) => r.grade !== r.previousGrade);
  const kept = rows.filter((r) => r.grade === r.previousGrade);
  const toA = changed.filter((r) => r.grade === 'A').length;
  const fromBrowser = changed.filter((r) => r.textFrom === 'local-browser').length;

  return (
    <section id="grade-changes" className="card grade-changes" aria-labelledby="grade-changes-head">
      <h3 id="grade-changes-head" className="summary-head">Grades re-checked with article text</h3>
      {error && <div className="banner error">{error}</div>}
      <p className="subtle grade-changes-intro">
        {rows.length === 0
          ? 'None in the last 30 days yet. When the daily grading re-checks an article with text from your browser or from Chromium, it is listed here.'
          : `Last 30 days: ${rows.length} re-checked, ${changed.length} changed grade`
            + `${toA ? `, ${toA} to A` : ''}${fromBrowser ? ` (${fromBrowser} from your browser)` : ''}.`}
      </p>
      {changed.length > 0 && <Rows rows={changed} />}
      {kept.length > 0 && (
        <details className="grade-changes-kept">
          <summary>Show the {kept.length} that kept their grade</summary>
          <Rows rows={kept} />
        </details>
      )}
    </section>
  );
}
