import { useMemo, useState } from 'react';
import type { Filters, Me, TaxonomyDimension } from '../api.ts';
import { FilterBar } from '../components/FilterBar.tsx';
import { ArticleList, makeLabeller } from '../components/ArticleList.tsx';
import { AnalysisTable } from '../components/AnalysisTable.tsx';
import { useArticles } from '../hooks.ts';

/**
 * News, Archive and Favorites are the same screen with different fixed
 * filters — one component rather than three near-copies.
 */
export function Feed({
  taxonomy, me, fixed, title, description,
}: {
  taxonomy: TaxonomyDimension[];
  me: Me;
  fixed?: Partial<Filters>;
  title: string;
  description: string;
}) {
  const state = useArticles(fixed);
  const label = useMemo(() => makeLabeller(taxonomy), [taxonomy]);

  const canFavorite = me.permissions.includes('favorites.write');
  const canReview = me.permissions.includes('hil.review');

  // Cards for reading, table for working. The table is the same component the
  // Lens uses, so sorting and export behave identically wherever they appear
  // rather than being reimplemented per page.
  const [view, setView] = useState<'cards' | 'table'>('cards');

  const labelFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of taxonomy) for (const v of d.values) map.set(`${d.dimension}:${v.value}`, v.label);
    return map;
  }, [taxonomy]);

  return (
    <>
      <h2>{title}</h2>
      <p className="subtle">{description}</p>

      <FilterBar
        taxonomy={taxonomy} filters={state.filters}
        onChange={state.setFilters} facets={state.facets}
      />

      {state.error && <div className="banner error">{state.error}</div>}

      <div className="viewswitch">
        <button type="button" className={`btn-quiet${view === 'cards' ? ' is-on' : ''}`}
                aria-pressed={view === 'cards'} onClick={() => setView('cards')}>Cards</button>
        <button type="button" className={`btn-quiet${view === 'table' ? ' is-on' : ''}`}
                aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
      </div>

      {view === 'table' ? (
        <AnalysisTable
          articles={state.articles}
          total={state.total}
          labels={labelFor}
          filters={state.filters}
          onSort={state.setSort}
          onFilterProcess={(value) => state.setFilters((f) => ({
            ...f,
            l1Processes: f.l1Processes.includes(value) ? f.l1Processes : [...f.l1Processes, value],
          }))}
        />
      ) : (
      <ArticleList
        articles={state.articles}
        total={state.total}
        label={label}
        loading={state.loading}
        onFavorite={state.toggleFavorite}
        onDecide={canReview ? state.decide : undefined}
        canFavorite={canFavorite}
        canReview={canReview}
        onLoadMore={state.loadMore}
      />
      )}
    </>
  );
}
