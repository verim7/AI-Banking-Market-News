import { useMemo } from 'react';
import type { Filters, Me, TaxonomyDimension } from '../api.ts';
import { FilterBar } from '../components/FilterBar.tsx';
import { ArticleList, makeLabeller } from '../components/ArticleList.tsx';
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

  return (
    <>
      <h2>{title}</h2>
      <p className="subtle">{description}</p>

      <FilterBar taxonomy={taxonomy} filters={state.filters} onChange={state.setFilters} />

      {state.error && <div className="banner error">{state.error}</div>}

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
    </>
  );
}
