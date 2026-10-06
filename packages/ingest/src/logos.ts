/**
 * Logos for the institutions that matter most, fetched without a person.
 *
 * Which ones: every Tier 1 and Tier 2 bank and every provider of rank 1 or 2
 * in the tier registry that has no file in packages/web/public/logos yet. The
 * smaller institutions get their monogram, as before.
 *
 * Where from: the institution's Wikipedia article, its Wikidata item, and the
 * "logo image" (P154) on that item. P154 can only point at Wikimedia Commons,
 * and Commons only holds freely licensed or public-domain files, so a logo
 * found this way is one the tracker may show; a fair-use logo is never picked
 * up, and its institution is reported as not found instead. Nothing is guessed:
 * no search result, favicon or look-alike is ever used.
 *
 * Runs in GitHub Actions (.github/workflows/fetch-logos.yml), which can reach
 * Wikimedia. Three steps there:
 *   --plan  --out <dir>   find the files and download a 256px PNG of each
 *   (python)              square each one onto a 128px transparent canvas
 *   --apply --from <dir>  copy them in, record source and licence, list them
 *                         in LOGO_SLUGS
 * The pure parts below are unit-tested; the network parts are not.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INSTITUTIONS, type Institution } from '../../web/src/lib/tiers.ts';
import { LOGO_SLUGS, logoSlug } from '../../web/src/lib/institutions.ts';

export const LOGO_DIR = 'packages/web/public/logos';
export const SOURCES = 'docs/logo-sources.json';
export const INSTITUTIONS_FILE = 'packages/web/src/lib/institutions.ts';

const UA = 'ai-banking-market-news logo fetcher (https://github.com/verim7/ai-banking-market-news)';

/** Tier 1, Tier 2, and providers of rank 1 or 2: the institutions that get a logo. */
export const wantsLogo = (i: Institution): boolean =>
  i.group === 'tier1' || i.group === 'tier2' || (i.group === 'provider' && (i.rank ?? 3) <= 2);

/** Those of them with no file yet, optionally only the names asked for. */
export function missingLogos(
  institutions: readonly Institution[], have: ReadonlySet<string>, only?: readonly string[],
): Institution[] {
  const asked = only?.length ? new Set(only.map((n) => logoSlug(n))) : null;
  return institutions.filter((i) => {
    const slug = logoSlug(i.name);
    if (have.has(slug)) return false;
    if (asked) return asked.has(slug) || (i.aliases ?? []).some((a) => asked.has(logoSlug(a)));
    return wantsLogo(i);
  });
}

interface Claim {
  rank?: string;
  mainsnak?: { datavalue?: { value?: unknown } };
  qualifiers?: Record<string, unknown>;
}

/**
 * The current logo among an item's P154 claims: a preferred one if there is
 * one, otherwise the first normal one, never a deprecated one, and never one
 * with an end date (P582), which is a logo the institution no longer uses.
 */
export function pickLogoFile(claims: readonly Claim[]): string | null {
  const current = claims.filter((c) => c.rank !== 'deprecated' && !c.qualifiers?.P582);
  const chosen = current.find((c) => c.rank === 'preferred') ?? current[0];
  const v = chosen?.mainsnak?.datavalue?.value;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * The Wikidata item of the first title that is a real article, not a
 * disambiguation page. Pages come back keyed by page id, with the redirects
 * already followed.
 */
export function pickItem(
  titles: readonly string[],
  response: { query?: { pages?: Record<string, { title?: string; missing?: string; pageprops?: Record<string, string> }>;
    redirects?: { from: string; to: string }[]; normalized?: { from: string; to: string }[] } },
): string | null {
  const pages = Object.values(response.query?.pages ?? {});
  const resolve = (t: string): string => {
    let out = t;
    for (const n of response.query?.normalized ?? []) if (n.from === out) out = n.to;
    for (const r of response.query?.redirects ?? []) if (r.from === out) out = r.to;
    return out;
  };
  for (const t of titles) {
    const page = pages.find((p) => p.title === resolve(t));
    if (!page || page.missing !== undefined || !page.pageprops) continue;
    if (page.pageprops.disambiguation !== undefined) continue;
    if (page.pageprops.wikibase_item) return page.pageprops.wikibase_item;
  }
  return null;
}

/** LOGO_SLUGS in institutions.ts, rewritten with the new slugs in order. */
export function withSlugs(source: string, add: readonly string[]): string {
  const open = 'export const LOGO_SLUGS: ReadonlySet<string> = new Set<string>([';
  const start = source.indexOf(open);
  const end = source.indexOf(']);', start);
  if (start < 0 || end < 0) throw new Error('LOGO_SLUGS not found in institutions.ts');
  const current = [...source.slice(start + open.length, end).matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  const all = [...new Set([...current, ...add])].sort();
  const lines: string[] = [];
  let line = ' ';
  for (const s of all) {
    const piece = ` '${s}',`;
    if (line.length + piece.length > 93) { lines.push(line); line = ' '; }
    line += piece;
  }
  if (line.trim()) lines.push(line);
  return `${source.slice(0, start + open.length)}\n${lines.join('\n')}\n${source.slice(end)}`;
}

/* ------------------------------------------------------------ network */

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

const api = (host: string, params: Record<string, string>) =>
  `https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '1', ...params })}`;

interface Found { slug: string; name: string; file: string; desc: string; lic: string; png: string }

async function findLogo(i: Institution, outDir: string): Promise<Found | string> {
  const titles = [i.name, ...(i.aliases ?? [])];
  const wiki = await getJson(api('en.wikipedia.org', {
    action: 'query', titles: titles.join('|'), redirects: '1', prop: 'pageprops',
    ppprop: 'wikibase_item|disambiguation',
  }));
  const item = pickItem(titles, wiki);
  if (!item) return 'no Wikipedia article with a Wikidata item';

  const claims = await getJson(api('www.wikidata.org', { action: 'wbgetclaims', entity: item, property: 'P154' }));
  const file = pickLogoFile(claims.claims?.P154 ?? []);
  if (!file) return `no logo image (P154) on ${item}`;

  const info = await getJson(api('commons.wikimedia.org', {
    action: 'query', titles: `File:${file}`, prop: 'imageinfo',
    iiprop: 'url|extmetadata', iiurlwidth: '256',
  }));
  const page = Object.values(info.query?.pages ?? {})[0] as any;
  const ii = page?.imageinfo?.[0];
  if (!ii?.thumburl) return `no rendering of File:${file} on Commons`;
  const lic = String(ii.extmetadata?.LicenseShortName?.value ?? '').trim();
  if (!lic) return `File:${file} carries no licence on Commons`;

  const res = await fetch(ii.thumburl, { headers: { 'User-Agent': UA } });
  if (!res.ok) return `download of File:${file} failed (${res.status})`;
  const slug = logoSlug(i.name);
  const png = join(outDir, `${slug}.png`);
  writeFileSync(png, Buffer.from(await res.arrayBuffer()));
  return { slug, name: i.name, file, desc: ii.descriptionurl, lic, png };
}

async function plan(outDir: string, only: string[]) {
  mkdirSync(outDir, { recursive: true });
  const todo = missingLogos(INSTITUTIONS, LOGO_SLUGS, only);
  console.log(`${todo.length} institution(s) without a logo: ${todo.map((i) => i.name).join(', ') || 'none'}`);
  const found: Found[] = [];
  const notFound: { name: string; why: string }[] = [];
  for (const i of todo) {
    try {
      const r = await findLogo(i, outDir);
      if (typeof r === 'string') notFound.push({ name: i.name, why: r });
      else found.push(r);
    } catch (e) {
      notFound.push({ name: i.name, why: (e as Error).message });
    }
    await new Promise((ok) => setTimeout(ok, 300)); // polite to Wikimedia
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ found, notFound }, null, 2));
  for (const f of found) console.log(`Found ${f.name}: File:${f.file} (${f.lic})`);
  for (const n of notFound) console.log(`Not found ${n.name}: ${n.why}`);
}

function apply(fromDir: string) {
  const { found } = JSON.parse(readFileSync(join(fromDir, 'manifest.json'), 'utf8')) as { found: Found[] };
  if (!found.length) { console.log('No new logos.'); return; }
  const sources = JSON.parse(readFileSync(SOURCES, 'utf8')) as Record<string, { desc: string; lic: string }>;
  for (const f of found) {
    if (!existsSync(f.png)) throw new Error(`${f.png} is missing`);
    copyFileSync(f.png, join(LOGO_DIR, `${f.slug}.png`));
    sources[f.slug] = { desc: f.desc, lic: f.lic };
  }
  // The file's own format: sorted keys, one-space indent, no final newline.
  const sorted = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeFileSync(SOURCES, JSON.stringify(sorted, null, 1));
  writeFileSync(INSTITUTIONS_FILE, withSlugs(readFileSync(INSTITUTIONS_FILE, 'utf8'), found.map((f) => f.slug)));
  console.log(`Added ${found.length} logo(s): ${found.map((f) => f.slug).join(', ')}`);
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = (arg('names') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (process.argv.includes('--plan')) await plan(arg('out') ?? 'logo-plan', only);
  else if (process.argv.includes('--apply')) apply(arg('from') ?? 'logo-plan');
  else { console.error('Use --plan --out <dir> or --apply --from <dir>.'); process.exit(1); }
}
