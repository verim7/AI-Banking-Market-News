import { useCallback, useEffect, useState } from 'react';
import { api, type ArticleTextItem } from '../api.ts';

/**
 * Articles no crawler could read, waiting for their text from the editor's
 * own browser.
 *
 * Built to be worked by a Claude routine on the editor's computer, through
 * Claude in Chrome, as much as by hand: every article has its link, one box
 * labelled with its title, and two buttons. The routine opens the link in a
 * new tab, writes a short summary in its own words and at most one quoted
 * sentence, and saves; or says why it
 * could not. The tracker then rescores the article and the next grading pass
 * reads the text (docs/local-browser-routine.md).
 *
 * The text is kept private: graded, never shown in the app, never put in the
 * public repository. One quoted sentence may become a use case's evidence.
 */

const REASONS = ['paywall', 'page not found', 'not an article', 'blocked or captcha', 'other'];

const shortDate = (d: string | null) => (d
  ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  : 'date unknown');

export function ArticleTextQueue() {
  const [items, setItems] = useState<ArticleTextItem[] | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [quotes, setQuotes] = useState<Record<string, string>>({});
  // No pop-up for the reason: a routine driving the browser handles a select
  // far more reliably than a dialog.
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.articleTextQueue(20);
      setItems(r.articles);
      setWaiting(r.waiting);
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (items === null) return null;

  const done = async (id: string, action: () => Promise<unknown>, message: string) => {
    setBusy(id);
    setError(null);
    try {
      await action();
      setNotice(message);
      setTexts(({ [id]: _, ...rest }) => rest);
      setQuotes(({ [id]: _q, ...rest }) => rest);
      await load();
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      // A server error can come after the text was stored (it did on 9 Oct),
      // so the list is reloaded: if the article left it, the save worked.
      setError(status >= 500
        ? `The tracker did not answer properly (error ${status}). The save may still have worked: the list `
          + 'has been reloaded, and an article that is no longer listed was saved. Otherwise try again in a minute.'
        : (e as Error).message);
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="article-text" className="card article-text" aria-labelledby="article-text-head">
      <h3 id="article-text-head" className="summary-head">Article text</h3>
      <p className="subtle article-text-intro">
        {waiting === 0
          ? 'Nothing waiting. Every article in the view from the last seven days has its text, or was tried.'
          : `${waiting} article${waiting === 1 ? '' : 's'} from the last seven days could not be read by the crawler `
            + 'or the browser on GitHub. Open each one and write a short summary in your own words (who did '
            + 'what with AI, and how far along it is), with at most one sentence quoted exactly as evidence. '
            + 'Not the article itself. Or say why it could not be read. Used for grading only: not shown in the '
            + 'tracker or put in the public repository.'}
      </p>
      {notice && <div className="banner">{notice}</div>}
      {error && <div className="banner error">{error}</div>}
      <ol className="article-text-list">
        {items.map((a) => {
          const text = texts[a.id] ?? '';
          const quote = quotes[a.id] ?? '';
          const box = `article-text-${a.id}`;
          return (
            <li key={a.id} className="article-text-item" data-article-id={a.id}>
              <p className="article-text-title">
                <a href={a.resolvedUrl ?? a.url} target="_blank" rel="noopener noreferrer">{a.title}</a>
              </p>
              <p className="article-text-meta">
                {a.source} · {shortDate(a.publishedAt)} · AI focus {a.aiIntensity}
                {' · '}{a.grade ? `graded ${a.grade} from the headline` : 'not graded yet'}
                {a.namesInstitution && ' · names a tracked institution'}
              </p>
              <label htmlFor={box} className="article-text-field">
                Summary, in your own words: who did what with AI, and how far along it is
                <span className="sr-only"> for: {a.title}</span>
              </label>
              <textarea id={box} rows={3} value={text} disabled={busy !== null} maxLength={1200}
                        onChange={(e) => setTexts({ ...texts, [a.id]: e.target.value })} />
              <label htmlFor={`${box}-quote`} className="article-text-field">
                One sentence quoted exactly, naming the institution and what it uses AI for (optional)
                <span className="sr-only"> for: {a.title}</span>
              </label>
              <textarea id={`${box}-quote`} rows={2} value={quote} disabled={busy !== null} maxLength={400}
                        onChange={(e) => setQuotes({ ...quotes, [a.id]: e.target.value })} />
              <div className="article-text-actions">
                <button type="button" className="primary" disabled={busy !== null || text.trim().length < 80}
                        onClick={() => done(a.id, () => api.saveArticleNote(a.id, text, quote),
                          `Saved the summary of “${a.title}”. It is graded in the next pass.`)}>
                  Save summary
                </button>
                <label className="article-text-reason">
                  <span className="sr-only">Why it could not be read</span>
                  <select value={reasons[a.id] ?? 'paywall'} disabled={busy !== null}
                          onChange={(e) => setReasons({ ...reasons, [a.id]: e.target.value })}>
                    {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
                <button type="button" className="btn-quiet" disabled={busy !== null}
                        onClick={() => done(a.id, () => api.skipArticleText(a.id, reasons[a.id] ?? 'paywall'),
                          `Marked \u201c${a.title}\u201d as not readable.`)}>
                  Could not read
                </button>
                <span className="article-text-count">{text.trim().length} of 1,200 characters</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
