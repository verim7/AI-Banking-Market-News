# Graphify and Obsidian — a map of this codebase

[Graphify](https://github.com/Graphify-Labs/graphify) reads the repository and
builds a knowledge graph of it: every function, component and module as a node,
every import and call as an edge. It can write that graph out as an
[Obsidian](https://obsidian.md) vault, so the codebase opens as a clickable
graph — which page calls which helper, which test covers which function.

Tested against this repository with Graphify 0.9.66: **1,073 nodes and about
2,300 edges from 142 files, grouped into 55–70 communities, written as roughly
1,140 Obsidian notes** — and no model called. The node count is stable; the
community count is not, because the clustering is not identical between runs,
so two maps of the same commit can group a few functions differently.

## Set it up on your machine

Once:

```bash
uv tool install graphifyy     # the package has two y's; the command has one
graphify install              # registers /graphify with Claude Code
```

No `uv`? `brew install uv` on a Mac, or `pipx install graphifyy` instead. If
`graphify` is not found afterwards, run `uv tool update-shell` and open a new
terminal.

Then, from the repository root, whenever you want a fresh map:

```bash
graphify update .                                      # parse the code
graphify cluster-only . --no-label                     # group it into communities
graphify export obsidian --dir graphify-out/obsidian   # write the vault
```

Open `graphify-out/obsidian/` in Obsidian (*Open folder as vault*), then the
graph view. `graphify-out/graph.html` is the same graph in a browser, and
`GRAPH_REPORT.md` beside it lists the central concepts and surprising links.

To keep it current without thinking about it, `graphify hook install` adds a
git hook that re-runs the code pass after every commit.

## What it may read, and why `data/` is not on the list

`.graphifyignore` at the root excludes `data/`. That is the one line in it that
matters. `data/` holds four megabytes of collected news and hand-graded body
excerpts, which are not code — and one of them contains a journalist's byline
email that came in with a scraped page (see `docs/data-classification.md`). A
code map has no use for any of it. The graph above was checked for this: no
node from `data/`, and no email address anywhere in it.

## The model question

The three commands above are **deterministic**. Code is parsed with tree-sitter;
`--no-label` leaves communities numbered instead of asking a model to name
them. Nothing leaves your machine.

Graphify *can* also run a semantic pass over the Markdown docs, and that one
does call a model — your assistant's, when you type `/graphify .` in Claude Code,
or a configured API key otherwise. That is fine on your machine, in a session
you started, which is the same place this project already does its review
reading.

It is **never** fine as a pipeline step. `CLAUDE.md` is explicit that there is
no model in the pipeline and no scheduled AI, so Graphify does not go into a
GitHub Actions workflow, and no model API key goes into the repository's
secrets for it. If the map is ever wanted in CI, the code-only commands above
are the whole of what may run there.

## Not done, on purpose

- **`graphify-out/` is not committed.** Graphify's own docs suggest committing
  it so a team starts with a map. This repository is public, and the map is a
  derived view that rebuilds in seconds, so it is gitignored.
- **No project-scoped skill.** `graphify install --project` would copy
  Graphify's skill file into `.claude/skills/`. The user-level `graphify install`
  above already gives you `/graphify` in every project, without putting a
  third-party file into this one.
- **SQL is not mapped yet.** The 11 migration files contribute nothing unless the
  SQL grammar is installed: `uv tool install 'graphifyy[sql]'`.
