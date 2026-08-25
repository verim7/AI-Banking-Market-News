export interface Tag { dimension: string; value: string }

/**
 * A reviewed use case: written by reading the article rather than matched from
 * it. Null when nobody has reviewed the article, which the UI must show — a
 * reader has to know whether a description was quoted or composed.
 */
export interface Review {
  grade: 'A' | 'B' | 'C' | 'D';
  headline: string;
  actor: string | null;
  task: string | null;
  technique: string | null;
  outcome: string | null;
  evidence: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface Article {
  id: string;
  url: string;
  title: string;
  summary: string | null;
  source: string;
  publisherKind: string;
  publishedAt: string | null;
  fetchedAt: string;
  enrichedBy: string;
  relevance: number;
  /** How central AI is to the article, 0-100. Separate from relevance. */
  aiIntensity: number;
  maturity: 'in_production' | 'pilot' | 'announced' | 'research' | 'unknown';
  /** The phrase the maturity was read from, so the claim can be checked. */
  maturityEvidence: string | null;
  /** The article's own sentence describing the use case. Never generated. */
  useCaseEvidence: string | null;
  /** A few of the article's own sentences. Extractive, never written. */
  summaryExtract: string | null;
  ruleHits: { rule: string; term: string; weight: number }[];
  isFavorite: boolean;
  hilDecision: 'relevant' | 'not_relevant' | 'undecided';
  hilNote: string;
  review: Review | null;
  tags: Tag[];
}

/**
 * One article with its body text, from GET /api/articles/:id.
 *
 * Separate from Article because the extract runs to 4000 characters, and
 * carrying that across a 200-row page would add most of a megabyte to every
 * Lens load for text nobody has asked to read yet.
 */
export interface ArticleDetail extends Article {
  /** The article's own text, fetched from the page. Null when it could not be read. */
  excerpt: string | null;
}

export type SortKey =
  | 'promise' | 'published' | 'relevance' | 'aiIntensity' | 'title'
  | 'source' | 'maturity';

export interface Filters {
  regions: string[];
  bankingAreas: string[];
  bankCategories: string[];
  useCases: string[];
  aiTypes: string[];
  l1Processes: string[];
  maturities: string[];
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
  aiTypes: [], l1Processes: [], maturities: [], grades: [], minAiIntensity: null,
  publisherKinds: [], search: '', from: '', to: '', minRelevance: null,
});

export interface Me {
  email: string;
  displayName: string;
  roles: { id: string; name: string }[];
  permissions: string[];
  scopes: { roleId: string; dimension: string; value: string }[];
}

export interface TaxonomyDimension {
  dimension: string;
  label: string;
  /**
   * Whether this dimension is offered as a filter and charted.
   *
   * Every dimension is returned regardless, because the analysis table and the
   * export need the labels for tags in dimensions nobody filters on.
   */
  filterable: boolean;
  values: { value: string; label: string }[];
}

/** Headline counts for the whole filtered view, counted server-side. */
export interface Measures {
  total: number;
  /** The article describes the use case in its own words and an AI type is known. */
  confirmedUseCases: number;
  /** One of the two, not both. */
  possibleUseCases: number;
  /** Reviewed and graded A or B — read, not inferred. */
  reviewedUseCases: number;
  /** Reviewed and graded A: a named institution running it. */
  deployedUseCases: number;
  /** How many articles in the view have been reviewed at all. */
  reviewedTotal: number;
}

/** How the coverage chart buckets time. */
export type TrendBucket = 'day' | 'week' | 'month';

/** The option meaning "no value in this dimension". Mirrors @portal/shared. */
export const UNCLASSIFIED = '__none__';
export const UNCLASSIFIED_LABEL = 'Not classified';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });

  if (!res.ok) {
    let message = `${res.status}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch { /* a non-JSON error body is still an error */ }
    throw new ApiError(res.status, message);
  }

  return res.json() as Promise<T>;
}

function toQuery(filters: Partial<Filters>, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams(extra);
  const put = (k: string, v: string[] | undefined) => {
    if (v && v.length) q.set(k, v.join(','));
  };
  put('regions', filters.regions);
  put('bankingAreas', filters.bankingAreas);
  put('bankCategories', filters.bankCategories);
  put('useCases', filters.useCases);
  put('publisherKinds', filters.publisherKinds);
  put('aiTypes', filters.aiTypes);
  put('l1Processes', filters.l1Processes);
  put('maturities', filters.maturities);
  put('grades', filters.grades);
  if (filters.minAiIntensity !== null && filters.minAiIntensity !== undefined) {
    q.set('minAiIntensity', String(filters.minAiIntensity));
  }
  if (filters.sort) q.set('sort', filters.sort);
  if (filters.sortDir) q.set('sortDir', filters.sortDir);
  if (filters.includeDuplicates) q.set('includeDuplicates', 'true');
  if (filters.search) q.set('search', filters.search);
  if (filters.from) q.set('from', filters.from);
  if (filters.to) q.set('to', filters.to);
  if (filters.minRelevance !== null && filters.minRelevance !== undefined) {
    q.set('minRelevance', String(filters.minRelevance));
  }
  if (filters.favoritesOnly) q.set('favoritesOnly', 'true');
  if (filters.hilDecision) q.set('hilDecision', filters.hilDecision);
  return q.toString();
}

export const api = {
  login: (email: string, password: string) =>
    request<{ email: string }>('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () => request<Me>('/api/auth/me'),

  taxonomy: () => request<{
    dimensions: TaxonomyDimension[];
    defaultRelevanceThreshold: number;
  }>('/api/articles/taxonomy'),

  articles: (filters: Partial<Filters>, page = { limit: 50, offset: 0 }) =>
    request<{ total: number; limit: number; offset: number; articles: Article[] }>(
      `/api/articles?${toQuery(filters, {
        limit: String(page.limit), offset: String(page.offset),
      })}`),

  article: (id: string) =>
    request<{ article: ArticleDetail }>(`/api/articles/${encodeURIComponent(id)}`),

  facets: (filters: Partial<Filters>) =>
    request<{
      facets: { dimension: string; value: string; n: number }[];
      measures: Measures;
    }>(`/api/articles/facets?${toQuery(filters)}`),

  trend: (filters: Partial<Filters>, bucket: TrendBucket = 'day') =>
    request<{ bucket: TrendBucket; trend: { day: string; n: number }[] }>(
      `/api/articles/trend?${toQuery(filters, { bucket })}`),


  decide: (id: string, decision: string, note = '') =>
    request<{ ok: boolean }>(`/api/hil/${id}`, {
      method: 'PUT', body: JSON.stringify({ decision, note }),
    }),

  decideBulk: (articleIds: string[], decision: string, note = '') =>
    request<{ ok: boolean; updated: number }>('/api/hil/bulk', {
      method: 'POST', body: JSON.stringify({ articleIds, decision, note }),
    }),

  /** Returns raw CSV text so the caller can save it or convert it to XLSX. */
  exportCsv: async (articleIds: string[], filters: Partial<Filters>): Promise<string> => {
    const res = await fetch('/api/hil/export', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ articleIds, filters }),
    });
    if (!res.ok) throw new ApiError(res.status, 'export failed');
    return res.text();
  },

  admin: {
    roles: () => request<{
      roles: {
        id: string; name: string; description: string; builtIn: boolean;
        permissions: string[]; scopes: { dimension: string; value: string }[];
      }[];
      availablePermissions: { key: string; description: string }[];
    }>('/api/admin/roles'),

    createRole: (name: string, description: string) =>
      request<{ id: string }>('/api/admin/roles', {
        method: 'POST', body: JSON.stringify({ name, description }),
      }),

    deleteRole: (roleId: string) =>
      request<{ ok: boolean }>(`/api/admin/roles/${roleId}`, { method: 'DELETE' }),

    setRolePermissions: (roleId: string, permissions: string[]) =>
      request<{ ok: boolean }>(`/api/admin/roles/${roleId}/permissions`, {
        method: 'PUT', body: JSON.stringify({ permissions }),
      }),

    setRoleScopes: (roleId: string, scopes: { dimension: string; value: string }[]) =>
      request<{ ok: boolean }>(`/api/admin/roles/${roleId}/scopes`, {
        method: 'PUT', body: JSON.stringify({ scopes }),
      }),

    users: () => request<{
      users: {
        id: string; email: string; displayName: string; active: boolean;
        createdAt: string; roles: { id: string; name: string }[];
      }[];
    }>('/api/admin/users'),

    createUser: (email: string, displayName: string, password: string, roleIds: string[]) =>
      request<{ id: string }>('/api/admin/users', {
        method: 'POST', body: JSON.stringify({ email, displayName, password, roleIds }),
      }),

    setUserRoles: (userId: string, roleIds: string[]) =>
      request<{ ok: boolean }>(`/api/admin/users/${userId}/roles`, {
        method: 'PUT', body: JSON.stringify({ roleIds }),
      }),

    setUserActive: (userId: string, active: boolean) =>
      request<{ ok: boolean }>(`/api/admin/users/${userId}/active`, {
        method: 'PUT', body: JSON.stringify({ active }),
      }),

    setUserPassword: (userId: string, password: string) =>
      request<{ ok: boolean }>(`/api/admin/users/${userId}/password`, {
        method: 'PUT', body: JSON.stringify({ password }),
      }),

    sources: () => request<{
      sources: {
        id: string; name: string; url: string; kind: string;
        publisher_kind: string; region_hint: string | null; enabled: number;
      }[];
      lastRun: Record<string, unknown> | null;
    }>('/api/admin/sources'),

    setSourceEnabled: (sourceId: string, enabled: boolean) =>
      request<{ ok: boolean }>(`/api/admin/sources/${sourceId}/enabled`, {
        method: 'PUT', body: JSON.stringify({ enabled }),
      }),

    runs: () => request<{ runs: Record<string, unknown>[] }>('/api/admin/runs'),
  },
};

export { ApiError };
