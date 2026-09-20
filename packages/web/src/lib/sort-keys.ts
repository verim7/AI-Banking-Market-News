/**
 * The orderings the API will accept, as a type.
 *
 * A mirror of `SORT_COLUMNS` in `packages/worker/src/queries.ts`. A key that is
 * not in that allowlist does not error — it silently falls back to `promise` —
 * so a mistyped sort looks like a column header that does nothing, which is a
 * bug that takes a while to notice. The union is the cheap guard against it,
 * and `packages/web/tests/lens-columns.test.ts` asserts the two lists agree.
 *
 * It lives in its own file, apart from `api.ts`, for a boring but real reason.
 * `api.ts` calls browser `fetch` with `credentials: 'same-origin'`, and
 * `tsconfig.test.json` loads `@cloudflare/workers-types` so the tests can reach
 * the worker's modules. Under those types `RequestInit` is the Workers one and
 * has no `credentials`, so anything a test imports must not drag `api.ts` in
 * behind it. A type in a file of its own costs nothing and keeps the table's
 * column definitions importable from a test.
 */
export type SortKey =
  | 'grade' | 'promise' | 'published' | 'relevance' | 'aiIntensity' | 'title'
  | 'source' | 'maturity' | 'agentStage';
