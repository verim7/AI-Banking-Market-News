#!/usr/bin/env node
/**
 * Find a site's real feed address.
 *
 * Fifteen of the configured sources answer 404. The URLs were written without
 * network access to verify them, and writing new ones the same way would just
 * produce a different wrong list. This asks each site instead.
 *
 *   npm run discover -- https://www.bcg.com
 *   npm run discover -- --all          # every failing source in sources.yaml
 *
 * A candidate is only reported once parseFeed() has actually parsed it and
 * found items, so "found" means found, not "returned 200".
 */
import { loadSources } from './sources.ts';
import { parseFeed } from './fetch-rss.ts';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
         + 'Chrome/130.0.0.0 Safari/537.36 ai-banking-market-news/1.0';

/** Paths worth trying when a site publishes no autodiscovery tag. */
const COMMON_PATHS = [
  '/feed', '/feed/', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml',
  '/en/feed', '/news/feed', '/news/rss', '/insights/rss', '/blog/feed',
  '/rss/news.xml', '/feeds/news', '/?feed=rss2',
];

async function get(url: string, timeoutMs = 15_000): Promise<{ status: number; body: string; type: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/html;q=0.8, */*' },
    });
    return { status: res.status, body: await res.text(), type: res.headers.get('content-type') ?? '' };
  } finally {
    clearTimeout(timer);
  }
}

/** <link rel="alternate" type="application/rss+xml" href="…"> */
export function autodiscover(html: string, base: string): string[] {
  const out: string[] = [];
  const linkTag = /<link\b[^>]*>/gi;
  for (const [tag] of html.matchAll(linkTag)) {
    if (!/rel\s*=\s*["']?alternate/i.test(tag)) continue;
    if (!/type\s*=\s*["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    try { out.push(new URL(href, base).toString()); } catch { /* skip malformed href */ }
  }
  return [...new Set(out)];
}

interface Found { url: string; items: number; title: string }

async function validate(url: string): Promise<Found | null> {
  try {
    const { status, body } = await get(url);
    if (status !== 200) return null;
    const items = parseFeed(body);
    if (items.length === 0) return null;
    return { url, items: items.length, title: items[0]?.title?.slice(0, 60) ?? '' };
  } catch {
    return null;
  }
}

async function discover(siteUrl: string): Promise<Found[]> {
  const found: Found[] = [];
  const seen = new Set<string>();

  const push = async (candidate: string) => {
    if (seen.has(candidate) || found.length > 0) return;
    seen.add(candidate);
    const ok = await validate(candidate);
    if (ok) found.push(ok);
  };

  // If the given URL is itself a feed, we are done.
  await push(siteUrl);

  if (found.length === 0) {
    try {
      const { body } = await get(siteUrl);
      for (const link of autodiscover(body, siteUrl)) await push(link);
    } catch { /* homepage unreachable; fall through to path probing */ }
  }

  if (found.length === 0) {
    const origin = new URL(siteUrl).origin;
    for (const path of COMMON_PATHS) await push(origin + path);
  }

  return found;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    console.error('Usage:\n  npm run discover -- https://www.bcg.com\n  npm run discover -- --all');
    process.exit(1);
  }

  const targets: { id: string; url: string }[] = argv.includes('--all')
    ? loadSources({ includeDisabled: true }).filter((s) => s.kind === 'rss').map((s) => ({ id: s.id, url: new URL(s.url).origin }))
    : argv.map((u) => ({ id: new URL(u).hostname, url: u }));

  console.log(`Probing ${targets.length} site(s). Only feeds that actually parse are reported.\n`);

  const results: { id: string; found: Found | null }[] = [];
  for (const t of targets) {
    process.stdout.write(`  ${t.id.padEnd(32)} `);
    const found = await discover(t.url);
    const best = found[0] ?? null;
    console.log(best ? `found — ${best.items} items` : 'no feed found');
    results.push({ id: t.id, found: best });
  }

  const hits = results.filter((r) => r.found);
  console.log(`\n${hits.length}/${results.length} sites have a working feed.\n`);

  if (hits.length > 0) {
    console.log('Paste these url: lines into packages/ingest/src/sources.yaml:\n');
    for (const r of hits) console.log(`  # ${r.id}\n  url: ${r.found!.url}`);
  }

  const misses = results.filter((r) => !r.found);
  if (misses.length > 0) {
    console.log(`\nNo feed at all: ${misses.map((m) => m.id).join(', ')}`);
    console.log('These need a GDELT domain query instead — see sources.yaml for the pattern.');
  }
}

// Only run as a CLI, so the tests can import autodiscover().
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
