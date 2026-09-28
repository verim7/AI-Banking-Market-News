import { useCallback, useEffect, useState } from 'react';
import { api, type DigestDraft } from '../api.ts';
import { useMediaQuery } from '../hooks.ts';

/**
 * The editor's review of the weekly email, before it goes to colleagues.
 *
 * Grading is automatic and publishes every morning; this is where a person
 * checks what the tracker says to people outside it. The Tuesday Routine
 * drafts the issue; every line of it is listed here with a box, ticked, and
 * the email beside it is rendered by the same code that sends it. Untick a
 * line and it leaves the email, and every count in it, at once. Approve and
 * the email on the right is the one Wednesday sends, byte for byte.
 */

type Draft = DigestDraft;
type Line = { id: string; lead: string; text: string; meta: string; url?: string };

const STAGE: Record<string, string> = {
  in_production: 'In production', pilot: 'Pilot', announced: 'Announced', research: 'Study',
};

const shortDate = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`)
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const when = (iso: string) => new Date(iso)
  .toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The draft's sections as lists of lines the editor can leave out, in the email's order. */
function sectionsOf(d: Draft): { title: string; note?: string; lines: Line[] }[] {
  const m = d.model;
  const entry = (e: Draft['model']['other'][number]): Line => ({
    id: e.id,
    lead: e.actor,
    text: e.task,
    meta: [e.tierText, STAGE[e.maturity] ?? 'Stage not stated', `${e.source}, ${shortDate(e.date)}`,
      ...(e.reports > 1 ? [`${e.reports} reports`] : [])].join(' · '),
    url: e.url,
  });
  return [
    { title: 'Agentic AI in production', lines: m.agenticLive.map(entry) },
    { title: 'Agentic AI in pilot', lines: m.agenticPilot.map(entry) },
    { title: 'Other AI use cases', lines: m.other.map(entry) },
    {
      title: 'Around the market',
      lines: m.news.map((n) => ({ id: n.id, lead: '', text: n.headline,
        meta: `${n.source}, ${shortDate(n.date)}`, url: n.url })),
    },
    ...(m.tier1Month ? [{
      title: `Tier 1 banks, ${m.tier1Month.label}`,
      note: 'The monthly reminder at the foot of the email.',
      lines: m.tier1Month.items.map((i) => ({ id: i.id, lead: i.institution, text: i.text,
        meta: [i.stage ?? 'Market news', `${i.source}, ${shortDate(i.date)}`].join(' · '), url: i.url })),
    }] : []),
  ].filter((s) => s.lines.length > 0);
}

export function BriefReview() {
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const wide = useMediaQuery('(min-width: 1180px)');

  const load = useCallback(async () => {
    try {
      setDraft((await api.digestDraft()).draft);
    } catch (e) {
      setError((e as Error).message);
      setDraft(null);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (draft === undefined) return null;

  if (draft === null) {
    return (
      <section className="card brief-review" aria-labelledby="brief-review-head">
        <h3 id="brief-review-head" className="summary-head">This week&rsquo;s email</h3>
        {error && <div className="banner error">{error}</div>}
        <p className="subtle brief-review-intro">
          No email drafted yet. The weekly Routine drafts it on Tuesday morning; it then
          waits here for you to review and approve before it goes out on Wednesday.
        </p>
      </section>
    );
  }

  const excluded = new Set(draft.excluded);
  const sent = Boolean(draft.sentAt);
  const sections = sectionsOf(draft);
  const allIds = [...new Set(sections.flatMap((s) => s.lines.map((l) => l.id)))];
  const sentences = draft.summary?.sentences ?? [];
  const included = allIds.filter((id) => !excluded.has(id)).length;

  const toggle = async (key: string) => {
    const next = new Set(excluded);
    if (next.has(key)) next.delete(key); else next.add(key);
    // The box answers the click at once; the email beside it follows when the
    // server has re-rendered it.
    setDraft({ ...draft, excluded: [...next] });
    setBusy(true);
    setError(null);
    try {
      const r = await api.excludeFromDraft([...next]);
      setNotice(r.withdrawn ? 'Your approval was withdrawn, because the email changed. Approve it again when it is right.' : null);
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!window.confirm(`Approve "${draft.subject}"? It goes to the list on Wednesday morning, `
      + 'exactly as shown on the right.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.approveDraft();
      setNotice('Approved. It goes out on Wednesday morning, and the summary is on Trends & Summary now.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.withdrawDraft();
      setNotice('Approval withdrawn. Nothing goes out until you approve again.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const status = sent
    ? `Sent ${when(draft.sentAt!)}${draft.recipients ? ` to ${draft.recipients} colleagues` : ''}`
    : draft.approvedAt
      ? `Approved ${when(draft.approvedAt)}. Goes out Wednesday morning`
      : 'Draft, not approved';

  const preview = (
    <iframe
      className="brief-review-frame"
      title="The email as it will be sent"
      // No scripts, no same-origin: the email is shown, not run.
      sandbox=""
      srcDoc={draft.html}
    />
  );

  return (
    <section className="card brief-review" aria-labelledby="brief-review-head">
      <h3 id="brief-review-head" className="summary-head">This week&rsquo;s email</h3>
      <p className="brief-review-subject">{draft.subject}</p>
      <p className="subtle brief-review-intro">
        {`${draft.week}, covering ${shortDate(draft.model.windowStart)} to ${shortDate(draft.asOf)}. `}
        Untick anything that should not go to colleagues: it leaves the email and its
        counts at once. Then approve.
      </p>

      <div className="brief-review-bar">
        <span className={`brief-review-status${draft.approvedAt ? ' is-approved' : ''}`}>{status}</span>
        <span className="brief-review-counts">{included} of {allIds.length} items included</span>
        {!sent && (draft.approvedAt
          ? <button type="button" className="btn-quiet" disabled={busy} onClick={withdraw}>Withdraw approval</button>
          : <button type="button" className="primary" disabled={busy} onClick={approve}>Approve for Wednesday</button>)}
      </div>

      {notice && <div className="banner">{notice}</div>}
      {error && <div className="banner error">{error}</div>}
      {draft.summaryNote && <p className="brief-review-note">Summary: {draft.summaryNote}</p>}

      <div className="brief-review-layout">
        <div className="brief-review-lines">
          {sentences.length > 0 && (
            <fieldset className="brief-review-group">
              <legend>This week in brief <span className="subtle">(written with AI)</span></legend>
              <ul>
                {sentences.map((s, i) => {
                  const key = `summary:${i}`;
                  // Goes with its articles: see applyExclusions.
                  const orphaned = s.cites.length > 0 && s.cites.every((id) => excluded.has(id));
                  return (
                    <li key={key} className={excluded.has(key) || orphaned ? 'is-out' : ''}>
                      <label>
                        <input type="checkbox" disabled={busy || sent || orphaned}
                               checked={!excluded.has(key) && !orphaned}
                               onChange={() => toggle(key)} />
                        <span className="brief-line-text">{s.text}</span>
                      </label>
                      {orphaned && <p className="brief-line-meta">Left out with the articles it cites.</p>}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}
          {sections.map((sec) => (
            <fieldset key={sec.title} className="brief-review-group">
              <legend>{sec.title}</legend>
              {sec.note && <p className="subtle brief-review-group-note">{sec.note}</p>}
              <ul>
                {sec.lines.map((l) => (
                  <li key={`${sec.title}-${l.id}`} className={excluded.has(l.id) ? 'is-out' : ''}>
                    <label>
                      <input type="checkbox" disabled={busy || sent} checked={!excluded.has(l.id)}
                             onChange={() => toggle(l.id)} />
                      <span className="brief-line-text">
                        {l.lead && <strong>{l.lead}</strong>}{l.lead && ' '}{l.text}
                      </span>
                    </label>
                    <p className="brief-line-meta">
                      {l.meta}
                      {l.url && <> · <a href={l.url} target="_blank" rel="noopener noreferrer">Read</a></>}
                    </p>
                  </li>
                ))}
              </ul>
            </fieldset>
          ))}
        </div>
        {wide
          ? <div className="brief-review-preview">{preview}</div>
          : <details className="brief-review-preview"><summary>Show the email</summary>{preview}</details>}
      </div>
    </section>
  );
}
