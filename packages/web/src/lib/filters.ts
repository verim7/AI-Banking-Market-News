/**
 * The filter state, and an empty one.
 *
 * In its own file for the same reason `sort-keys.ts` and `measures.ts` are:
 * `tsconfig.test.json` loads `@cloudflare/workers-types`, and under those types
 * `api.ts`'s `fetch(..., { credentials })` does not compile — so anything a
 * unit test imports must not drag the API client in behind it, not even for a
 * type. `lib/filter-chips.ts` derives chips from this shape and is tested, so
 * the shape lives here.
 *
 * `api.ts` re-exports both, so every existing `from '../api.ts'` import site
 * keeps working and there is still one name for each of these.
 */

import type { SortKey } from './sort-keys.ts';

export interface Filters {
  regions: string[];
  bankingAreas: string[];
  bankCategories: string[];
  useCases: string[];
  aiTypes: string[];
  l1Processes: string[];
  maturities: string[];
  /** Swiss nexus grades. Empty means "every article", as every filter does. */
  chNexus: string[];
  /** Swiss institutions by canonical name, from the Agentic Swiss Banks chart. */
  chInstitutions: string[];
  /** How far along with agents. Empty means every article, as every filter does. */
  agentStages: string[];
  grades: string[];
  minAiIntensity: number | null;
  publisherKinds: string[];
  sort?: SortKey;
  sortDir?: 'asc' | 'desc';
  search: string;
  from: string;
  to: string;
  minRelevance: number | null;
  includeDuplicates?: boolean;
  favoritesOnly?: boolean;
  hilDecision?: 'relevant' | 'not_relevant' | 'undecided' | null;
}

export const emptyFilters = (): Filters => ({
  regions: [], bankingAreas: [], bankCategories: [], useCases: [],
  aiTypes: [], l1Processes: [], maturities: [], chNexus: [], chInstitutions: [], agentStages: [], grades: [],
  minAiIntensity: null,
  publisherKinds: [], search: '', from: '', to: '', minRelevance: null,
});

/**
 * Every filterable dimension, and the field it writes.
 *
 * Exported because the chip row derives itself from this map rather than
 * keeping its own list — a dimension that could be filtered but not un-filtered
 * from a chip would be a filter the reader cannot see they applied.
 */
export const FILTER_KEY: Record<string, keyof Filters> = {
  region: 'regions',
  banking_area: 'bankingAreas',
  bank_category: 'bankCategories',
  use_case: 'useCases',
  ai_type: 'aiTypes',
  l1_process: 'l1Processes',
  publisher_kind: 'publisherKinds',
  maturity: 'maturities',
  grade: 'grades',
  agent_stage: 'agentStages',
  ch_nexus: 'chNexus',
  // Not a taxonomy dimension and not offered as a dropdown: it is the
  // institution the Swiss nexus was read from, set by clicking a bar on the
  // Agentic Swiss Banks chart. It belongs here so that click gets a chip, and
  // therefore a way back out that does not require finding the same bar again.
  ch_nexus_evidence: 'chInstitutions',
};

/**
 * What each dimension is called, where the name is not the taxonomy's own.
 *
 * One record, because these names appear in three places — the dropdown's
 * label, the chip that dropdown produces, and the page-level `extra` lists in
 * MarketLens. Three literals would be three chances to say "Agents running?"
 * in two different ways.
 */
export const DIMENSION_LABELS = {
  grade: 'Use case grade',
  maturity: 'Stage',
  publisher_kind: 'Source type',
  agent_stage: 'Agents running?',
  ch_nexus: 'Swiss link',
  ch_nexus_evidence: 'Swiss institution',
  // `as const satisfies` rather than a plain `Record<string, string>`: under
  // `noUncheckedIndexedAccess` that type makes every lookup `string |
  // undefined`, and the three call sites that name a key directly would each
  // need a `?? ''` that could never fire.
} as const satisfies Record<string, string>;

/**
 * Filters with every selection dropped, and the view settings kept.
 *
 * Exported because two controls clear now — the filter bar's Clear button and
 * the chip row's "Clear all" — and two copies of this object is how they would
 * come to clear different things.
 */
export const clearedFilters = (filters: Filters): Filters => ({
  ...emptyFilters(),
  // Clearing filters must not move you to another queue: the Review Queue's
  // three lists are defined by this one. The date window and sort are view
  // settings, not filters, so they stay.
  hilDecision: filters.hilDecision,
  from: filters.from,
  to: filters.to,
  sort: filters.sort,
  sortDir: filters.sortDir,
});
