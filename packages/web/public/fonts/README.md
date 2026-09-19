# Source Sans 3

The house typeface, self-hosted.

**Source Sans 3 is Source Sans Pro.** Adobe renamed it at version 3; it is the
same design, and "Source Sans Pro" in the Format Guidelines means this file.

## Why these files are in the repository

Two reasons, and the first one is not optional:

1. The Worker sends `Content-Security-Policy: default-src 'self'` with no
   `font-src` directive. A font loaded from `fonts.gstatic.com` would be
   refused by the browser — the page would silently fall back to the system
   stack and nothing would say why.
2. No request to a third party on every page load.

## What is here

| File | Covers |
|---|---|
| `source-sans-3-latin.woff2` | Latin, upright |
| `source-sans-3-latin-ext.woff2` | Latin Extended, upright |
| `source-sans-3-latin-italic.woff2` | Latin, italic |

Each is a **variable** font spanning weights 400–700, so semibold headings and
regular body text share one download. Cyrillic, Greek and Vietnamese subsets
exist upstream and are deliberately not shipped: this app's text is English,
French and German, and the three subsets would add roughly 180 kB for
characters that never render.

Version 19 of the Google Fonts build. To refresh, take the `latin`,
`latin-ext` and `latin` italic `@font-face` blocks from
`https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400..700;1,400..700`
requested with a browser user agent — an older one is served TrueType instead
of woff2 — and keep the `unicode-range` values in `styles.css` in step with
whatever that response says.

## Licence

SIL Open Font License 1.1 — full text in `OFL.txt`. Copyright 2010-2020 Adobe,
with Reserved Font Name 'Source'. The licence permits bundling and serving the
files like this; it forbids selling the font on its own and requires that any
modified version be renamed.
