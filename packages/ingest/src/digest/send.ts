/**
 * One email out through Resend's REST API.
 *
 * No SDK: it is one POST, and a dependency for one POST is a dependency that
 * can break the ingest install. Recipients go in BCC so colleagues never see
 * each other's addresses, in chunks under Resend's limit of 50 per message.
 *
 * Every chunk carries an idempotency key built from the issue and the chunk,
 * so a workflow re-run after a network error cannot mail anyone twice — Resend
 * answers the repeat with the first result instead of sending again.
 */

export interface Mail {
  from: string;
  /** The visible recipient. For a list send, the editor's own address. */
  to: string;
  bcc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  /** Stable per logical send, e.g. `digest-2026-W40-list-0`. */
  idempotencyKey: string;
}

const RESEND_URL = 'https://api.resend.com/emails';
export const BCC_CHUNK = 45;

export async function sendMail(apiKey: string, mail: Mail): Promise<string> {
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'idempotency-key': mail.idempotencyKey,
    },
    body: JSON.stringify({
      from: mail.from,
      to: [mail.to],
      ...(mail.bcc?.length ? { bcc: mail.bcc } : {}),
      ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    // Resend's error names the problem ("You can only send testing emails to
    // your own email address…"), and that sentence is the fix. It never echoes
    // the key, so the whole body is safe to print.
    throw new Error(`Resend refused the message (HTTP ${res.status}): ${body}`);
  }
  return (JSON.parse(body) as { id?: string }).id ?? '';
}

/** Split a comma- or newline-separated secret into addresses. */
export function addressList(raw: string | undefined): string[] {
  return [...new Set((raw ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter((s) => s.includes('@')))];
}

export function chunks<T>(list: readonly T[], size = BCC_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
