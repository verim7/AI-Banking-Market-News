/**
 * The headline counts the API returns for a filtered view.
 *
 * In its own file for the same reason `sort-keys.ts` is: `tsconfig.test.json`
 * loads `@cloudflare/workers-types`, and under those types `api.ts`'s
 * `fetch(..., { credentials })` does not compile — so anything a unit test
 * imports must not drag the API client in behind it. `lib/summary.ts` needs
 * this shape and is tested, so the shape lives here.
 */

/** Headline counts for the whole filtered view, counted server-side. */
export interface Measures {
  total: number;
  /**
   * Distinct use cases, not articles.
   *
   * One use case is routinely several reports — four outlets on Starling's
   * corporate assistant, nine months of re-reporting on Morgan Stanley's
   * adviser tool. The *UseCases figures below are folded on the same key the
   * analysis table folds rows with; the matching *Reports figures are the
   * article counts they came from, so the tile can show both.
   */
  /** The article describes the use case in its own words and an AI type is known. */
  confirmedUseCases: number;
  confirmedReports: number;
  /** One of the two, not both. Articles — there is not enough to fold on. */
  possibleUseCases: number;
  /** Reviewed and graded A or B — read, not inferred. */
  reviewedUseCases: number;
  reviewedReports: number;
  /** Reviewed and graded A: a named institution running it. */
  deployedUseCases: number;
  deployedReports: number;
  /** How many articles in the view have been reviewed at all. */
  reviewedTotal: number;
}
