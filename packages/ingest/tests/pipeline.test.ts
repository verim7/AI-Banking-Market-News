import { describe, expect, it } from 'vitest';
import { REGIONS, classify, type ClassifiedArticle } from '@portal/shared';
import { parseFeed } from '../src/fetch-rss.ts';
import { dedupe, normalize } from '../src/normalize.ts';
import { articleStatements } from '../src/load-d1.ts';
import { backfillSources, dailySources, loadSources } from '../src/sources.ts';
import { parseArgs } from '../src/run.ts';

/**
 * End-to-end over a fixture feed: XML in, SQL out. This is the path the daily
 * job takes, minus the network, so a regression anywhere along it fails here.
 */

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>McKinsey Financial Services</title>
    <item>
      <title>How Swiss private banks are deploying generative AI copilots</title>
      <link>https://example.com/study?utm_campaign=newsletter</link>
      <description>A McKinsey study finds relationship managers at wealth
        management firms using AI copilots for meeting preparation.</description>
      <pubDate>Tue, 18 Aug 2026 09:30:00 GMT</pubDate>
    </item>
    <item>
      <title>How Swiss private banks are deploying generative AI copilots</title>
      <link>https://www.example.com/study/</link>
      <description>Duplicate of the story above, arriving from a second feed.</description>
      <pubDate>Tue, 18 Aug 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Quarterly results announcement</title>
      <link>https://example.com/results</link>
      <description>Revenue rose four percent.</description>
      <pubDate>Tue, 18 Aug 2026 11:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const SOURCE = { id: 'mck', name: 'McKinsey Financial Services', publisherKind: 'consultancy' as const };

function run(): ClassifiedArticle[] {
  const items = parseFeed(FEED);
  const normalized = dedupe(
    items.map((i) => normalize(i, SOURCE)).filter((a): a is NonNullable<typeof a> => a !== null),
  );
  return normalized.map((a) => ({
    ...a,
    classification: classify({
      title: a.title, summary: a.summary, excerpt: a.excerpt,
      publisherKind: a.publisherKind, publishedAt: a.publishedAt,
      regionHint: null, now: new Date('2026-08-20T00:00:00Z'),
    }),
  }));
}

describe('feed → normalise → classify → SQL', () => {
  it('collapses the duplicate that arrived under a different URL form', () => {
    const out = run();
    expect(out).toHaveLength(2);
  });

  it('scores the AI study high and the results announcement at zero', () => {
    const out = run();
    const study = out.find((a) => a.title.includes('generative AI'))!;
    const results = out.find((a) => a.title.includes('Quarterly'))!;
    expect(study.classification.relevanceScore).toBeGreaterThan(40);
    expect(results.classification.relevanceScore).toBe(0);
  });

  it('tags the study across all four dimensions', () => {
    const study = run().find((a) => a.title.includes('generative AI'))!;
    const dims = new Set(study.classification.tags.map((t) => t.dimension));
    expect(dims).toContain('region');
    expect(dims).toContain('banking_area');
    expect(dims).toContain('bank_category');
    expect(dims).toContain('use_case');
  });

  it('emits SQL that inserts the article, clears old tags and writes a score', () => {
    const study = run().find((a) => a.title.includes('generative AI'))!;
    const sql = articleStatements(study);
    expect(sql.some((s) => s.startsWith('INSERT INTO articles'))).toBe(true);
    expect(sql.some((s) => s.startsWith('DELETE FROM article_tags'))).toBe(true);
    expect(sql.some((s) => s.includes('INSERT INTO article_scores'))).toBe(true);
    // Every statement must be terminated, since they are batched into one body.
    for (const s of sql) expect(s.trim().endsWith(';')).toBe(true);
  });

  it('quotes an apostrophe in a headline rather than breaking the batch', () => {
    const [article] = run();
    const withQuote: ClassifiedArticle = { ...article!, title: "Europe's banks and AI" };
    const insert = articleStatements(withQuote).find((s) => s.startsWith('INSERT INTO articles'))!;
    expect(insert).toContain("Europe''s banks and AI");
  });
});

describe('sources.yaml', () => {
  it('loads, and every entry passes validation', () => {
    const sources = loadSources();
    // Enabled sources only. Feeds that 404 are disabled in place rather than
    // deleted, so `npm run discover` can try to re-find them later.
    expect(sources.length).toBeGreaterThan(15);
    expect(new Set(sources.map((s) => s.id)).size).toBe(sources.length);
  });

  it('includes each region the brief called out', () => {
    const hints = new Set(loadSources().map((s) => s.region_hint).filter(Boolean));
    expect(hints).toContain('singapore_apac');
    expect(hints).toContain('usa_north_america');
    expect(hints).toContain('switzerland');
    expect(hints).toContain('germany_dach');
  });
});

describe('source coverage the brief requires', () => {
  // Disabling the dead MAS and DBS feeds silently removed Singapore from the
  // portal entirely. Nothing caught it, because no test asserted that the
  // regions the brief names are actually reachable. This one does.
  const REQUIRED = ['singapore_apac', 'usa_north_america', 'switzerland', 'germany_dach'];

  it.each(REQUIRED)('has at least one enabled source hinting %s', (region) => {
    const hints = loadSources().map((s) => s.region_hint);
    expect(hints).toContain(region);
  });

  it('keeps disabled sources in the file so discovery can retry them', () => {
    const enabled = loadSources().length;
    const all = loadSources({ includeDisabled: true }).length;
    expect(all).toBeGreaterThan(enabled);
  });

  it('still has consultancy coverage after their RSS feeds died', () => {
    const kinds = loadSources().map((s) => s.publisher_kind);
    expect(kinds).toContain('consultancy');
  });
});

describe('--only, so a slow source kind cannot hide a stale feed', () => {
  test('defaults to every kind', () => {
    expect(parseArgs(['--check']).only).toBeNull();
  });

  test('accepts the two kinds that exist', () => {
    expect(parseArgs(['--check', '--only', 'rss']).only).toBe('rss');
    expect(parseArgs(['--check', '--only', 'gdelt']).only).toBe('gdelt');
  });

  // A typo silently checking nothing would report "0 sources failed", which
  // reads exactly like success.
  test('rejects a kind that does not exist rather than matching nothing', () => {
    expect(() => parseArgs(['--check', '--only', 'rrs'])).toThrow(/--only takes/);
  });

  test('selecting rss leaves out every GDELT query, and the reverse', () => {
    // Every configured source, enabled or not. The two kinds partitioning the
    // file is a property of the file; whether GDELT happens to be reachable
    // this week is not, and reading disabled sources keeps this asserting the
    // thing it is named after.
    const sources = loadSources({ includeDisabled: true });
    const rss = sources.filter((s) => s.kind === 'rss');
    const gdelt = sources.filter((s) => s.kind === 'gdelt');
    expect(rss.length).toBeGreaterThan(0);
    expect(gdelt.length).toBeGreaterThan(0);
    expect(rss.length + gdelt.length).toBe(sources.length);
  });
});

describe('what the daily run fetches', () => {
  const all = loadSources();
  // The GDELT queries are configured but disabled — api.gdeltproject.org resets
  // the connection from cloud runners, diagnosed 2026-08-28 and recorded in
  // docs/content-sourcing.md. The shape of that configuration is still worth
  // pinning, so the assertions below read it whether or not it is switched on.
  const configured = loadSources({ includeDisabled: true });

  test('GDELT is down to two queries a day', () => {
    const gdeltDaily = dailySources(configured).filter((s) => s.kind === 'gdelt');
    expect(gdeltDaily).toHaveLength(2);
  });

  test('and none of them is switched on, because the API is refusing us', () => {
    // Deliberate, and a test rather than a comment so that re-enabling GDELT is
    // an act somebody has to justify here as well as in the YAML. Flip this
    // when the curl in docs/content-sourcing.md returns 200.
    expect(dailySources(all).filter((s) => s.kind === 'gdelt')).toHaveLength(0);
  });

  // Rewritten after it failed. It asserted the queries pulled from the daily
  // run were "still available to the backfill", which restated a claim I had
  // made rather than checking one — only queries marked `backfill: true` ever
  // were, and those seven never had it. They are retired now, and the real
  // invariant is the one below: no enabled source may sit in neither job.
  test('the backfill still has a query after the daily trim', () => {
    expect(backfillSources(configured).length).toBeGreaterThan(0);
  });

  test('but there is no backfill at all while GDELT is disabled', () => {
    // Worth stating plainly: GDELT is the only source that can load history, so
    // disabling it makes `npm run backfill` a no-op rather than a slow success.
    expect(backfillSources(all)).toHaveLength(0);
  });

  test('every RSS source still runs daily — the trim is GDELT only', () => {
    const rss = all.filter((s) => s.kind === 'rss');
    const rssDaily = dailySources(all).filter((s) => s.kind === 'rss');
    expect(rssDaily.length).toBe(rss.length);
  });

  test('a source with no daily flag runs, so the default cannot silently drop one', () => {
    expect(dailySources([
      { id: 'a', name: 'A', url: 'u', kind: 'rss', publisher_kind: 'media' },
    ] as never)).toHaveLength(1);
  });

  // Three feeds returned the same seven articles every run.
  test('only one Finextra feed remains', () => {
    expect(all.filter((s) => s.id.startsWith('finextra'))).toHaveLength(1);
  });
});

describe('what the backfill fetches', () => {
  // Configured, not enabled: GDELT is switched off while its API refuses cloud
  // runners, and the selection rules below are still worth pinning.
  const all = loadSources({ includeDisabled: true });
  const configured = all;

  // Three queries over 37 months is 111 requests. A real run attempted 40, had
  // 31 refused, and covered a third of the span in 57 minutes. One query fits
  // every month into a single run instead.
  test('the backfill runs exactly one query', () => {
    expect(backfillSources(configured)).toHaveLength(1);
  });

  test('it is the broadest query, not a narrow one', () => {
    const [query] = backfillSources(configured);
    expect(query!.url).toContain('financial services');
    expect(query!.url).toContain('artificial intelligence');
  });

  // A source in neither job is dead configuration that looks alive.
  test('every enabled source runs in at least one job', () => {
    const backfillIds = new Set(backfillSources(all).map((s) => s.id));
    const dailyIds = new Set(dailySources(all).map((s) => s.id));
    const orphans = all
      .filter((s) => s.enabled !== false)
      .filter((s) => !dailyIds.has(s.id) && !backfillIds.has(s.id));
    expect(orphans.map((s) => s.id)).toEqual([]);
  });
});


describe('region hints', () => {
  const all = loadSources({ includeDisabled: true });

  // Three sources shipped with hints outside the taxonomy — germany,
  // singapore, north_america — and nothing complained, because loadSources
  // validated kind and publisher_kind but not this. A bad hint is not an
  // error anywhere downstream; classify() looks it up, finds nothing, and the
  // source silently contributes no region.
  test('every hint is a real taxonomy region', () => {
    const valid = new Set(REGIONS.map((r) => r.value));
    const bad = all
      .filter((s) => s.region_hint)
      .filter((s) => !valid.has(s.region_hint as string));
    expect(bad.map((s) => `${s.id}:${s.region_hint}`)).toEqual([]);
  });

  test('loading a source with an invented region fails loudly', () => {
    expect(() => loadSources({ path: 'packages/ingest/tests/fixtures/bad-region.yaml' }))
      .toThrow(/not a taxonomy region/);
  });
});
