# Design guidelines

House style for **every website, app or page** built here. Applies unless the
task explicitly says otherwise.

Source: the "Format Guidelines" sheet. The rules below are quoted from it; the
web translation that follows each one is the part that had to be worked out,
because the sheet describes slides and a browser is not a slide.

---

## Colours

> ⚠️ **The hex values are read off an image, not measured.** The sheet was
> supplied as a screenshot with no file to sample, so these are a careful eye
> match and may be a shade or two out. Replace them with the official brand
> values when they are to hand — every other rule in this file is exact.

| Role | Hex (read) | Use |
|---|---|---|
| **Main** — also body text | `#2E3948` | Text, headings, icons, primary surfaces |
| **Accent** | `#EE6B2D` | Bullets, links, the one thing per view that must be noticed |
| Salmon | `#F5A68E` | Secondary fills, chart series |
| Background (warm) | `#FCEEE8` | Page or section background |
| Background (cool) | `#D3DEE6` | Page or section background |
| Slate | `#536074` | Secondary text, borders, chart series |
| Light slate | `#A9B6C4` | Muted text, dividers, disabled states |

```css
:root {
  --main:        #2E3948;   /* text and headings */
  --accent:      #EE6B2D;   /* bullets, links, emphasis */
  --salmon:      #F5A68E;
  --bg-warm:     #FCEEE8;
  --bg-cool:     #D3DEE6;
  --slate:       #536074;
  --slate-light: #A9B6C4;
}
```

**Accent is a scalpel, not a paint roller.** It is the bullet colour and the
one highlight per view. A page where three things are orange has nothing
emphasised.

---

## Type

**Font: Source Sans Pro** for everything.

> A practical note the sheet cannot know: Adobe renamed it. On Google Fonts it
> is now **Source Sans 3**; "Source Sans Pro" is the frozen older release. Load
> Source Sans 3 and keep the old name in the stack so either resolves.

```css
font-family: "Source Sans 3", "Source Sans Pro", system-ui, -apple-system, sans-serif;
```

### The rules, verbatim, and what they mean on screen

| Sheet says | On the web |
|---|---|
| Main title: 26pt, dark blue, **All Nouns in Capital Letters** | `2rem` (32px), `--main`, Title Case |
| Subtitles: small letters; capitalise **only** what needs it — names, Synpulse, AI, LLM — and the first word | `1.25rem` (20px) / `1.125rem` (18px), `--main`, sentence case |
| **DON'T USE CAPITAL LETTER WORDS** | Never `text-transform: uppercase`. Not for labels, not for buttons, not for table headers. |
| Body: 12pt/10pt, nothing below 10pt | `1rem` (16px) / `0.875rem` (14px). **Never below 14px** — the "no text below 10pt" floor, kept proportional |
| Subtitle: maximum two lines | Constrain with `max-width`, do not let it wrap to three |

The pt sizes are for slides. The px values above keep the same *ratios* at web
reading distance rather than converting pt to px literally, which would give a
35px title and 13px body — too small to read comfortably on screen.

---

## Shape

> "Boxes: use rounded edges **only to highlight** — every other shape keeps
> sharp edges"

This is the rule most easily lost, because most CSS frameworks round
everything by default. Here, a rounded corner *means* something.

```css
/* Sharp is the default. Everything. */
* { border-radius: 0; }

/* Rounded is a signal, used deliberately and rarely. */
.highlight { border-radius: 6px; }
```

If you reach for `rounded-lg` on a card, stop: unless that card is the
highlighted one, it keeps square corners.

---

## Bullets

> "bullet points are squared and orange, exactly like these"

Square, `--accent`, never a disc and never the browser default.

```css
ul { list-style: none; padding-left: 1.25em; }
li { position: relative; }
li::before {
  content: "";
  position: absolute;
  left: -1.25em;
  top: 0.55em;
  width: 0.375em;
  height: 0.375em;
  background: var(--accent);   /* square: no border-radius */
}
```

---

## Icons and shadows

- **Icons: `--main` or a colour from the palette — never black.** `#000` is not
  in this design.
- **Shadows sparingly.** Prefer a `--slate-light` border to a drop shadow. If a
  shadow is used, one soft small one, not a stack.

---

## Checklist before calling a page done

1. Is anything `uppercase`? Remove it.
2. Is anything black (`#000`)? It should be `--main`.
3. Is anything rounded that is not the highlighted element? Square it.
4. Is any text below 14px? Raise it.
5. Is orange used more than once per view? Pick the one that matters.
6. Are bullets square and orange?
