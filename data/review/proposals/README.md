# Proposed grades

The weekly Routine writes its grades here, one JSONL file per pass, in the same
format as `data/review/decisions/`. They are **not** replayed into the
database's reviews. `review-apply --propose` copies them into
`review_proposals`, and the editor accepts, changes or discards each one in the
tracker's Review Queue before publishing. See `docs/weekly-digest.md`.
