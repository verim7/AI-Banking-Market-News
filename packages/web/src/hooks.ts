import { useCallback, useEffect, useRef, useState } from 'react';
import { api, emptyFilters, type Article, type Filters, type Measures } from './api.ts';
import type { Facet } from './components/FilterBar.tsx';

/** Debounce so typing in the search box does not fire a request per keystroke. */
export function useDebounced<T>(value: T, ms = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Whether a CSS media query matches, as state.
 *
 * Used for the one thing CSS cannot do on its own: the Market Lens draws a
 * *different tree* wide and narrow — a sticky `<aside>` beside the table, or a
 * closed `<details>` below it — rather than the same tree styled two ways. A
 * disclosure that is only visually collapsed still hands a screen reader and a
 * keyboard a column of charts between the table and the end of the page.
 *
 * Guards a missing `matchMedia` and a throwing one, and defaults to *false*,
 * so the narrow shape is what renders if the question cannot be asked. Mobile
 * is the default and the desktop layout is the enhancement.
 */
export function useMediaQuery(query: string): boolean {
  const read = useCallback(() => {
    if (typeof globalThis.matchMedia !== 'function') return false;
    try {
      return globalThis.matchMedia(query).matches;
    } catch {
      return false;
    }
  }, [query]);

  const [matches, setMatches] = useState(read);

  useEffect(() => {
    if (typeof globalThis.matchMedia !== 'function') return undefined;
    let mql: MediaQueryList;
    try {
      mql = globalThis.matchMedia(query);
    } catch {
      return undefined;
    }
    // Read once on subscribe as well: between the first render and this effect
    // the viewport can already have changed, and the listener only fires on
    // the next change after that.
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

const PAGE_SIZE = 50;

/**
 * Article list state: filters, pagination and optimistic favourite/decision
 * updates. Shared by News, Archive, Favorites and the HIL Checker, which differ
 * only in their fixed filters.
 */
export function useArticles(fixed: Partial<Filters> = {}) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [articles, setArticles] = useState<Article[]>([]);
  // Filter options come from the same request cycle as the list, so what is
  // offered always matches what is there — that is what stops a filter with no
  // results from being selectable.
  const [facets, setFacets] = useState<Facet[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debouncedSearch = useDebounced(filters.search);
  const effective = { ...filters, search: debouncedSearch, ...fixed };
  const key = JSON.stringify(effective);

  // A slow response for old filters must not overwrite a fast one for new
  // filters, so each request carries the key it was issued for.
  const latestKey = useRef(key);

  const load = useCallback(async (nextOffset: number, append: boolean) => {
    latestKey.current = key;
    setLoading(true);
    setError(null);
    try {
      const [res, facetRes] = await Promise.all([
        api.articles(effective, { limit: PAGE_SIZE, offset: nextOffset }),
        append ? Promise.resolve(null) : api.facets(effective),
      ]);
      if (latestKey.current !== key) return;
      setArticles((prev) => (append ? [...prev, ...res.articles] : res.articles));
      setTotal(res.total);
      setOffset(nextOffset);
      if (facetRes) setFacets(facetRes.facets);
    } catch (err) {
      if (latestKey.current === key) setError((err as Error).message);
    } finally {
      if (latestKey.current === key) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { void load(0, false); }, [load]);

  const loadMore = () => void load(offset + PAGE_SIZE, true);
  const reload = () => void load(0, false);

  const patch = (id: string, changes: Partial<Article>) =>
    setArticles((prev) => prev.map((a) => (a.id === id ? { ...a, ...changes } : a)));

  const decide = async (id: string, decision: string) => {
    const previous = articles.find((a) => a.id === id)?.hilDecision ?? 'undecided';
    patch(id, { hilDecision: decision as Article['hilDecision'] });
    try {
      await api.decide(id, decision);
    } catch (err) {
      patch(id, { hilDecision: previous });
      setError((err as Error).message);
    }
  };

  const setSort = (sort: Filters['sort']) =>
    setFilters((f) => ({
      ...f,
      sort,
      // Clicking the same column again reverses it; a new column starts
      // descending, which is what "top of the list" means for a score.
      sortDir: f.sort === sort && f.sortDir === 'desc' ? 'asc' : 'desc',
    }));

  return {
    filters, setFilters, setSort, articles, total, facets, loading, error,
    loadMore, reload, decide, effective,
  };
}

/**
 * Everything the Market Lens and Trends & Summary draw from, in one place.
 *
 * The two pages ask the same three questions of the same filters — what are
 * the counts, what does the shape look like, and which articles are they — so
 * they fetch together. Trends needs no article list and says so, which saves a
 * 200-row request it would never render.
 *
 * `measures.total` and `articles.total` are the same number by construction:
 * `buildMeasuresQuery` wraps the very same count query the list is built from.
 * That is what lets the table footer on one page and the tile on the other
 * reconcile, rather than agreeing by luck.
 */
export function useLensData(
  effective: Filters,
  bucket: string,
  { withArticles = true }: { withArticles?: boolean } = {},
) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [facets, setFacets] = useState<{ dimension: string; value: string; n: number }[]>([]);
  const [trend, setTrend] = useState<{ day: string; n: number }[]>([]);
  const [measures, setMeasures] = useState<Measures | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const key = JSON.stringify({ ...effective, bucket, withArticles });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      api.facets(effective),
      api.trend(effective, bucket as Parameters<typeof api.trend>[1]),
      withArticles ? api.articles(effective, { limit: 200, offset: 0 }) : Promise.resolve(null),
    ])
      .then(([f, t, a]) => {
        // A slow response for old filters must not overwrite a fast one for
        // new filters. Every setter below is behind this guard for that
        // reason, and removing it produces a page that is briefly, silently
        // wrong — the worst kind.
        if (cancelled) return;
        setFacets(f.facets);
        setMeasures(f.measures);
        setTrend(t.trend);
        setTotal(a ? a.total : f.measures.total);
        if (a) setArticles(a.articles);
      })
      .catch((err) => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { articles, facets, trend, measures, total, loading, error };
}
