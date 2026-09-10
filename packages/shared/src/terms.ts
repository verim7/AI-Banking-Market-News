/**
 * Word-boundary term matching, on its own so more than one classifier can use
 * it.
 *
 * It lived in classify.ts until the Swiss registry needed it too, and importing
 * classify.ts from swiss.ts while classify.ts imports swiss.ts is a cycle that
 * happens to work today and will stop working the first time either file grows
 * a top-level constant that reads across. One small module both can depend on
 * costs nothing and cannot cycle.
 */

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matcherCache = new Map<string, RegExp>();

/**
 * Build a case-insensitive matcher bounded by non-alphanumerics rather than \b.
 * \b is wrong for terms like "u.s." and "m&a", whose edges are not word chars.
 *
 * A trailing "s" is optional for terms of four characters or more, so "private
 * bank" matches "private banks" — headlines are written in the plural far more
 * often than taxonomies are. Short terms are excluded from this so the
 * abbreviations ("ai", "ki") keep matching exactly and "ai" never eats "ais".
 *
 * The space in a multi-word term matches a hyphen too. Headlines hyphenate
 * compounds at will — "big-tech earnings", "sell-off" — and a term list written
 * with spaces silently missed every hyphenated form. That is how "big tech"
 * failed to fire on "US big-tech earnings news".
 */
export function matcher(term: string): RegExp {
  let re = matcherCache.get(term);
  if (!re) {
    const pluralisable = term.length >= 4 && !term.endsWith('s');
    const body = escapeRegExp(term).replace(/\\?\s+/g, '[\\s\\-\u2010-\u2015]+')
               + (pluralisable ? 's?' : '');
    re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu');
    matcherCache.set(term, re);
  }
  return re;
}

/** Every term in `terms` that occurs in `text`, deduplicated and in order. */
export function matchTerms(text: string, terms: string[]): string[] {
  return terms.filter((t) => matcher(t).test(text));
}
