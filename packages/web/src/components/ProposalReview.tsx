import { useCallback, useEffect, useState } from 'react';
import { api, type Proposal, type ProposalChange } from '../api.ts';
import { tierLabel, tierOf } from '../lib/tiers.ts';

/**
 * The editor's gate: the grades the weekly Routine proposed, one card each.
 *
 * Nothing here is on the dashboard or in the weekly email until it is
 * published. Each card shows what the Routine read — the grade, the
 * institution and its tier, the task, the stage, and the sentence it was read
 * from — beside a link to the article itself, so the check is against the
 * source and not against the Routine's own summary of it.
 *
 * Accept takes the proposal as written. Change opens the fields the editor may
 * correct; saving validates them exactly as a decision file is validated, so a
 * changed A still needs its institution, task and a quote that names the task.
 * Discard leaves the article ungraded. Publish copies every accepted card into
 * the reviews the dashboard reads.
 */

const GRADE_TEXT: Record<string, string> = {
  A: 'A · use case',
  B: 'B · market news',
  C: 'C · retired',
  D: 'D · not relevant',
};

const STAGES: { value: string; label: string }[] = [
  { value: 'in_production', label: 'In production' },
  { value: 'pilot', label: 'Pilot' },
  { value: 'announced', label: 'Announced' },
  { value: 'research', label: 'Study' },
  { value: 'unknown', label: 'Not stated' },
];
const stageLabel = (v: string | null) => STAGES.find((s) => s.value === v)?.label ?? 'Not stated';

const STATUS_TEXT: Record<Proposal['status'], string> = {
  pending: 'Waiting',
  accepted: 'Accepted',
  discarded: 'Discarded',
};

export function ProposalReview() {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setProposals((await api.proposals()).proposals);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (proposals === null) return null;
  // Nothing proposed and nothing decided: no section at all, rather than an
  // empty box above the queue every other day of the week.
  if (proposals.length === 0 && !notice) return null;

  const waiting = proposals.filter((p) => p.status === 'pending').length;
  const accepted = proposals.filter((p) => p.status === 'accepted').length;
  const discarded = proposals.filter((p) => p.status === 'discarded').length;

  const decide = async (id: string, change: ProposalChange): Promise<string | null> => {
    setError(null);
    try {
      await api.decideProposal(id, change);
      await load();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  const acceptAllWaiting = async () => {
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    for (const p of proposals.filter((x) => x.status === 'pending')) {
      try { await api.decideProposal(p.articleId, { status: 'accepted' }); }
      catch { failed.push(p.actor ?? p.title); }
    }
    await load();
    setBusy(false);
    if (failed.length) setError(`Not accepted, open them to fix: ${failed.join(', ')}.`);
  };

  const publish = async () => {
    if (!window.confirm(`Publish ${accepted} accepted grade${accepted === 1 ? '' : 's'} to the dashboard? `
      + 'The weekly brief is built from what is published.')) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.publishProposals();
      setNotice(`Published ${r.published} grade${r.published === 1 ? '' : 's'}. They are on the dashboard now, `
        + 'and the weekly brief will be built from them.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card proposals" aria-labelledby="proposals-head">
      <h3 id="proposals-head" className="summary-head">Proposed grades</h3>
      <p className="subtle proposals-intro">
        The weekly Routine read the new articles and proposed a grade for each. Nothing
        below is on the dashboard or in the weekly brief until you publish it. Check each
        one against the article, then accept it, change it, or discard it.
      </p>

      <div className="proposals-bar">
        <span className="proposals-counts">
          {waiting} waiting · {accepted} accepted · {discarded} discarded
        </span>
        <button type="button" className="btn-quiet" disabled={busy || waiting === 0}
                onClick={acceptAllWaiting}>
          Accept all waiting
        </button>
        <button type="button" className="primary" disabled={busy || accepted === 0}
                onClick={publish}>
          Publish {accepted} accepted
        </button>
      </div>

      {notice && <div className="banner">{notice}</div>}
      {error && <div className="banner error">{error}</div>}

      <ul className="proposal-list">
        {proposals.map((p) => (
          <ProposalCard key={p.articleId} p={p} busy={busy} onDecide={decide} />
        ))}
      </ul>
    </section>
  );
}

function ProposalCard({ p, busy, onDecide }: {
  p: Proposal;
  busy: boolean;
  onDecide: (id: string, change: ProposalChange) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProposalChange>({});
  const [problem, setProblem] = useState<string | null>(null);

  const tier = p.actor ? tierLabel(tierOf(p.actor)) : null;
  const date = (p.publishedAt ?? p.fetchedAt).slice(0, 10);

  const open = () => {
    setDraft({ grade: p.grade, maturity: p.maturity ?? 'unknown', actor: p.actor ?? '',
      task: p.task ?? '', headline: p.headline });
    setProblem(null);
    setEditing(true);
  };

  const act = async (change: ProposalChange) => {
    const err = await onDecide(p.articleId, change);
    setProblem(err);
    if (!err) setEditing(false);
  };

  return (
    <li className={`proposal is-${p.status}`}>
      <div className="proposal-head">
        <span className={`grade grade-${p.grade}`}>{p.grade}</span>
        <span className="proposal-actor">{p.actor ?? 'No institution named'}</span>
        {tier && <span className="proposal-tier">{tier}</span>}
        <span className={`proposal-status status-${p.status}`}>
          {STATUS_TEXT[p.status]}{p.edited ? ', changed' : ''}
        </span>
      </div>
      <p className="proposal-headline">{p.headline}</p>
      <dl className="proposal-facts">
        <div><dt>Grade</dt><dd>{GRADE_TEXT[p.grade] ?? p.grade}</dd></div>
        {p.task && <div><dt>Task</dt><dd>{p.task}</dd></div>}
        <div><dt>Stage</dt><dd>{stageLabel(p.maturity)}</dd></div>
      </dl>
      {p.evidence && <q className="proposal-quote">{p.evidence}</q>}
      <p className="proposal-source">
        <a href={p.url} target="_blank" rel="noopener noreferrer">{p.title}</a>
        <span className="subtle"> {p.source}, {date}</span>
      </p>
      {p.notes && <p className="subtle proposal-notes">Routine&rsquo;s note: {p.notes}</p>}

      {editing ? (
        <div className="proposal-edit">
          <label>
            Grade
            <select value={draft.grade ?? ''} onChange={(e) => setDraft({ ...draft, grade: e.currentTarget.value })}>
              {['A', 'B', 'D'].map((g) => <option key={g} value={g}>{GRADE_TEXT[g]}</option>)}
            </select>
          </label>
          <label>
            Stage
            <select value={draft.maturity ?? 'unknown'}
                    onChange={(e) => setDraft({ ...draft, maturity: e.currentTarget.value })}>
              {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label>
            Institution
            <input value={draft.actor ?? ''} onChange={(e) => setDraft({ ...draft, actor: e.currentTarget.value })} />
          </label>
          <label>
            Task
            <input value={draft.task ?? ''} onChange={(e) => setDraft({ ...draft, task: e.currentTarget.value })} />
          </label>
          <label className="wide">
            Use case line
            <input value={draft.headline ?? ''}
                   onChange={(e) => setDraft({ ...draft, headline: e.currentTarget.value })} />
          </label>
          <div className="proposal-actions">
            <button type="button" className="btn-quiet proposal-accept" disabled={busy}
                    onClick={() => act({ ...draft, status: 'accepted' })}>
              Save and accept
            </button>
            <button type="button" className="btn-quiet" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="proposal-actions">
          {p.status !== 'accepted' && (
            // Not the accent: that is spent on Publish, the one action on
            // this card's page that changes what colleagues see.
            <button type="button" className="btn-quiet proposal-accept" disabled={busy}
                    onClick={() => act({ status: 'accepted' })}>
              Accept
            </button>
          )}
          <button type="button" className="btn-quiet" disabled={busy} onClick={open}>Change</button>
          {p.status !== 'discarded' && (
            <button type="button" className="btn-quiet" disabled={busy}
                    onClick={() => act({ status: 'discarded' })}>
              Discard
            </button>
          )}
          {p.status !== 'pending' && (
            <button type="button" className="btn-quiet" disabled={busy}
                    onClick={() => act({ status: 'pending' })}>
              Undo
            </button>
          )}
        </div>
      )}
      {problem && <p className="proposal-problem" role="alert">{problem}</p>}
    </li>
  );
}
