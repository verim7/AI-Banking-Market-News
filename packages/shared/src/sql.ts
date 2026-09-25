/**
 * SQL fragments that more than one package runs against D1.
 *
 * The worker's list queries and the weekly digest both need to know whether
 * an article describes agents and how far along they are. That used to be a
 * string inside `packages/worker/src/queries.ts`. The digest runs in Node from
 * a workflow and cannot import the worker's routes, so the string lives here
 * and both import it.
 *
 * Both expect the aliases the worker uses: `a` for articles, `sc` for
 * article_scores, `rv` for article_reviews.
 */

/** Tagged agentic by the classifier or the reviewer. */
export const IS_AGENTIC_SQL = `EXISTS (SELECT 1 FROM article_tags ag
                            WHERE ag.article_id = a.id
                              AND ag.dimension = 'ai_type'
                              AND ag.value = 'agentic_ai')`;

/**
 * running, pilot, announced or none. A reviewer's maturity wins over the
 * rules', exactly as everywhere else. See `AGENT_STAGE` in the worker's
 * queries for the reasoning behind the four values.
 */
export const AGENT_STAGE_SQL = `(CASE
    WHEN NOT ${IS_AGENTIC_SQL} THEN 'none'
    WHEN COALESCE(rv.maturity, sc.maturity, 'unknown') = 'in_production' THEN 'running'
    WHEN COALESCE(rv.maturity, sc.maturity, 'unknown') = 'pilot' THEN 'pilot'
    ELSE 'announced'
  END)`;
