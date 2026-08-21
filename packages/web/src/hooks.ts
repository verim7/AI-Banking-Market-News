import { useCallback, useEffect, useRef, useState } from 'react';
import { api, emptyFilters, type Article, type Filters } from './api.ts';
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

  const toggleFavorite = async (id: string, on: boolean) => {
    patch(id, { isFavorite: on });          // optimistic
    try {
      await api.favorite(id, on);
    } catch (err) {
      patch(id, { isFavorite: !on });       // and rolled back on failure
      setError((err as Error).message);
    }
  };

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
    loadMore, reload, toggleFavorite, decide, effective,
  };
}
