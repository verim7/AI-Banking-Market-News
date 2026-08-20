import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { PublisherKind } from '@portal/shared';

export interface SourceConfig {
  id: string;
  name: string;
  url: string;
  kind: 'rss' | 'gdelt';
  publisher_kind: PublisherKind;
  region_hint?: string | null;
  enabled?: boolean;
}

const VALID_KINDS = new Set(['rss', 'gdelt']);
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
  }

  return opts.includeDisabled ? sources : sources.filter((s) => s.enabled !== false);
}
