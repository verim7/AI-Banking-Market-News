# CLAUDE.md

## Papercuts

Maintain `docs/papercuts.md`, a log shared by every session in this repository
of anything that slowed development down. When you lose time to one
mid-session, append `date · symptom · fix · project` — while it is fresh,
not at the end. **Check this file first when tooling fails mysteriously.**

It is in the repository rather than `~/code/` on purpose: these sessions run in
a container that is reclaimed after a period of inactivity, so a log under
`$HOME` would start empty every time and never accumulate, which is the one
thing it exists to do. Committed to the repo it survives. The cost is that it
is per-repo rather than global.

## Reporting work

A green workflow is not proof that something happened. Check the effect — query
the database, read the row counts, open the artefact — before reporting that it
did. Say plainly when a check could not be run, and never read a proxy's error
page as a passing result.

## Design

Every website, app or page built here follows the house style in
`docs/design-guidelines.md` — colours, Source Sans Pro, square orange
bullets, sharp corners unless something is being highlighted, and no uppercase
words anywhere. **Read that file before writing any markup or CSS.**

The four that are broken most often, so they are repeated here: never
`text-transform: uppercase`; never `#000` (use the main colour); corners are
square by default and rounding is a deliberate highlight; nothing below 14px.
