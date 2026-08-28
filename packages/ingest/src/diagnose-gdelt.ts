/**
 * Why is GDELT unreachable?
 *
 * Both GDELT sources have been returning `TypeError: fetch failed` in the daily
 * ingest, and that message covers three answers needing three different fixes:
 * GDELT is down, GDELT is refusing this runner, or the request never left the
 * machine. Undici puts the part that tells them apart in `err.cause`, which
 * nothing was printing.
 *
 * So this asks four questions in order, cheapest first, and prints the cause
 * every time:
 *
 *   1. does DNS resolve the host          — ENOTFOUND means the name is gone
 *   2. does a control host answer         — proves egress works at all
 *   3. does the GDELT homepage answer     — separates the site from the API
 *   4. does the API answer                — and with what status and body
 *
 * A status is worth far more than an exception: 403 means blocked, 429 means
 * rate limited, 503 means down, and any of them would have been actionable a
 * day ago.
 */
import { lookup } from 'node:dns/promises';

const API = 'https://api.gdeltproject.org/api/v2/doc/doc'
          + '?query=bank&mode=artlist&format=json&maxrecords=1&timespan=1d';

/** The message plus the code undici hides one level down. */
function why(err: unknown): string {
  const cause = (err as { cause?: unknown }).cause;
  const code = (cause as { code?: string } | undefined)?.code;
  const inner = cause instanceof Error ? cause.message : String(cause ?? '');
  return [String(err), inner && `cause: ${inner}`, code && `code: ${code}`]
    .filter(Boolean).join('  ');
}

async function head(label: string, url: string): Promise<void> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { 'user-agent': 'ai-banking-market-news/1.0 (+https://github.com/verim7/AI-Banking-Market-News)' },
    });
    const body = (await res.text()).slice(0, 180).replace(/\s+/g, ' ');
    console.log(`  ${res.ok ? 'OK  ' : 'HTTP'} ${label}: ${res.status} ${res.statusText} `
              + `(${Date.now() - started}ms)`);
    console.log(`       content-type: ${res.headers.get('content-type') ?? '—'}`);
    if (body) console.log(`       body: ${body}`);
  } catch (err) {
    console.log(`  FAIL ${label}: ${why(err)} (${Date.now() - started}ms)`);
  }
}

async function main(): Promise<void> {
  console.log('1. DNS');
  for (const host of ['api.gdeltproject.org', 'www.gdeltproject.org']) {
    try {
      const { address, family } = await lookup(host);
      console.log(`  OK   ${host} -> ${address} (IPv${family})`);
    } catch (err) {
      console.log(`  FAIL ${host}: ${why(err)}`);
    }
  }

  // Without this, a total egress failure reads as "GDELT is down".
  console.log('\n2. Control host, to prove egress works at all');
  await head('example.com', 'https://example.com/');

  console.log('\n3. GDELT homepage');
  await head('gdeltproject.org', 'https://www.gdeltproject.org/');

  console.log('\n4. GDELT DOC API');
  await head('doc api', API);

  console.log('\nRead it as: DNS fails -> the host is gone. Control fails too -> '
            + 'this machine has no egress, and GDELT is not the story. Homepage '
            + 'answers but the API does not -> GDELT is up and the API is not. '
            + 'A status rather than an exception -> read the status.');
}

if (import.meta.filename === process.argv[1]) await main();
