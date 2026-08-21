import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { REGIONS, type PublisherKind } from '@portal/shared';

export interface SourceConfig {
  id: string;
  name: string;
  url: string;
  kind: 'rss' | 'gdelt';
  publisher_kind: PublisherKind;
  region_hint?: string | null;
  enabled?: boolean;
  /**
   * Include this source when loading history.
   *
   * The daily job can afford every query — one request each, once a day. The
   * backfill multiplies each by the number of months, so nine queries over two
   * years was 225 requests and got the run blocked outright, with 82% refused.
   * Only broad queries earn a place here; narrow ones return what the broad
   * ones already do, and region coverage comes from the classifier reading the
   * article text, not from a separate query per region.
   */
  backfill?: boolean;
  /**
   * Include this source in the daily run. Defaults to true.
   *
   * The mirror of `backfill`, and it exists because the assumption in the
   * comment above turned out to be wrong. The daily job could not afford every
   * GDELT query: a real run had six of eight refused with 429s and dropped
   * connections, contributed one article, and spent eleven of its twelve
   * minutes waiting between refusals. Requests to GDELT are rationed per
   * client however they are spread, so eight a day is already too many.
   *
   * Setting this false keeps a query for the backfill, where slow pacing is
   * expected and the wait buys thirty-six months rather than one day.
   */
  daily?: boolean;
}

const VALID_KINDS = new Set(['rss', 'gdelt']);
const VALID_REGIONS = new Set<string>(REGIONS.map((r) => r.value));
const VALID_PUBLISHERS = new Set(['consultancy', 'regulator', 'bank', 'media']);

export interface LoadOptions {
  path?: string;
  /** Include sources marked `enabled: false` — used by the discovery tool,
   *  which exists precisely to re-find the feeds that were disabled. */
  includeDisabled?: boolean;
}

export function loadSources(opts: LoadOptions = {}): SourceConfig[] {
  const file = opts.path ?? fileURLToPath(new URL('./sources.yaml', import.meta.url));
  const doc = parse(readFileSync(file, 'utf8')) as { sources?: SourceConfig[] };
  const sources = doc?.sources ?? [];

  const ids = new Set<string>();
  for (const s of sources) {
    if (!s.id || !s.name || !s.url) throw new Error(`Source missing id/name/url: ${JSON.stringify(s)}`);
    if (ids.has(s.id)) throw new Error(`Duplicate source id: ${s.id}`);
    ids.add(s.id);
    if (!VALID_KINDS.has(s.kind)) throw new Error(`Source ${s.id}: bad kind "${s.kind}"`);
    if (!VALID_PUBLISHERS.has(s.publisher_kind)) {
      throw new Error(`Source ${s.id}: bad publisher_kind "${s.publisher_kind}"`);
    }
    // A region_hint outside the taxonomy is silently useless: classify() looks
    // it up, finds nothing, and the source contributes no region at all. Three
    // sources shipped that way — germany, singapore and north_america, where
    // the taxonomy says germany_dach, singapore_apac and usa_north_america —
    // and nothing complained, including the source check, which only reports
    // whether a feed answered. Kinds and publishers were validated here from
    // the start; the hint was not, for no reason other than oversight.
    if (s.region_hint && !VALID_REGIONS.has(s.region_hint)) {
      throw new Error(
        `Source ${s.id}: region_hint "${s.region_hint}" is not a taxonomy region. `
        + `Valid: ${[...VALID_REGIONS].join(', ')}`);
    }
  }

  return opts.includeDisabled ? sources : sources.filter((s) => s.enabled !== false);
}

/** Sources the daily run fetches. See SourceConfig.daily. */
export function dailySources(all: SourceConfig[]): SourceConfig[] {
  return all.filter((s) => s.daily !== false);
}

/** The GDELT queries used to load history. See SourceConfig.backfill. */
export function backfillSources(all: SourceConfig[]): SourceConfig[] {
  return all.filter((s) => s.kind === 'gdelt' && s.backfill === true);
}
