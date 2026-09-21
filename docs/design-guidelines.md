# Design guidelines

House style for **every website, app or page** built here. Applies unless the
task explicitly says otherwise.

Source: the "Format Guidelines" sheet. The rules below are quoted from it; the
web translation that follows each one is the part that had to be worked out,
because the sheet describes slides and a browser is not a slide.

---

## Colours

> **Main and accent are confirmed exact.** `#394253` and `#F7682C` were given
> directly and are the real brand values — my earlier eye-match had both a
> shade off, which is why the rest still carry a warning.
>
> ⚠️ **The remaining five are read off a screenshot, not measured.** The sheet
> arrived as an image with no file to sample, so they are a careful eye match
> and may be a shade out. Replace them when the official values are to hand.

| Role | Hex (✔ exact · ~ estimated) | Use |
|---|---|---|
| **Main** — also body text | `#394253` ✔ | Text, headings, icons, primary surfaces |
| **Accent** | `#F7682C` ✔ | Bullets, links, the one thing per view that must be noticed |
| Salmon | `#F5A68E` ~ | Secondary fills, chart series |
| Background (warm) | `#FCEEE8` ~ | Page or section background |
| Background (cool) | `#D3DEE6` ~ | Page or section background |
| Slate | `#536074` ~ | Secondary text, borders, chart series |
| Light slate | `#A9B6C4` ~ | Muted text, dividers, disabled states |

```css
:root {
  --main:        #394253;   /* text and headings   — confirmed */
  --accent:      #F7682C;   /* bullets, links, emphasis — confirmed */
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

---

## What applying this to a real app taught us

Written after the first application, to the **Synpulse · AI Banking Tracker**. These are
not amendments to the sheet; they are the parts a browser forces you to decide.

### One orange is not enough tokens

`#F7682C` on a light page reads at **2.7:1**. That is below AA for body text,
so the brand colour cannot be the colour of a link. White on it is **3.0:1**,
so it cannot carry a white button label either. Neither fact is a reason to
change the colour — it is a reason to split the job:

```css
--accent:          #f7682c;  /* borders, rings, bullets, marks — decorative */
--accent-ink:      #b33f10;  /* accent-coloured TEXT (5.2:1 on the page)   */
--accent-solid:    #f7682c;  /* a filled control, still exactly on brand    */
--accent-on-solid: #1f2733;  /* its label: a dark step of --main, 5.0:1     */
```

The eye still sees `#F7682C` everywhere it matters — the mark, the primary
button, active states. Only the small text steps down, and it steps down within
the same hue, so nothing looks like a second orange.

On a dark surface the brand colour reads at 6.2:1 and needs no step at all, so
there `--accent-ink` *is* `#F7682C`.

### "Accent for links" does not survive a data table

The sheet gives links to the accent. In prose that is right. In a table where
every one of two hundred rows carries a link, it paints a whole column orange
and the accent stops meaning *look here* — which was its only job. So: links in
running text are `--accent-ink`; links inside `td` take `--text-primary` and
turn accent on hover.

Checklist item 5 is the rule this follows, not an exception to it.

### The house name is `--accent-ink`, for the same reason links are

The masthead reads `Synpulse · AI Banking Tracker` with *Synpulse* in the
accent. That is text, so it takes `--accent-ink` (5.2:1 on light) and not
`--accent` (2.7:1). The eye still reads it as the brand orange, because on the
dark surface the app opens on they are the same value.

And it is not uppercased. The sheet's own instruction is **DON'T USE CAPITAL
LETTER WORDS**, and its type rules list *Synpulse* among the words to
capitalise normally — so a masthead setting the company name as `SYNPULSE`
would break the sheet in the one place every reader looks. The wordmark had an
inherited `text-transform: uppercase`; the rebrand removed it.

The masthead is also outside the density exception below. A company name is not
a table header: it holds 15px, and 14px for the qualifier, at every width.

### Dark mode needs its own steps

A chart series validated on a light surface is not valid on a dark one. The
brand orange sits above the dark palette's lightness band, so charts on dark use
`#E86134` — the nearest step inside it. Both palettes were checked with the
data-viz validator rather than judged by eye, on both surfaces.

### A documented exception: density

The banking app keeps table headers uppercase at 11px and its 5px corners. That
breaks checklist items 1, 3 and 4 **on purpose**: it is a dense analyst tool
whose layout was built around that scale, and raising every label to 14px costs
rows per screen. The colours and the typeface are the house style; the density
is the app's own and was signed off as such.

Do not "fix" this in passing. If it is ever revisited, it is a layout change
with its own screenshots, not a search and replace.
