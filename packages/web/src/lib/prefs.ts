/**
 * Remembered choices, for settings small enough that asking again is rude.
 *
 * Browser storage is the right size for "which sort did I pick last time" and
 * the wrong size for anything else: it is per-browser, per-device, and it can
 * vanish. Nothing here is allowed to matter — every caller must render
 * correctly when reading returns null, because that is what happens the first
 * time, in a private window, and behind a blocked-cookies setting.
 *
 * Two failure modes, and both are handled here rather than at each call site:
 *
 *  1. `localStorage` does not exist at all. True in Node — which is where this
 *     app's tests run, since vitest is configured for the node environment —
 *     and true in some embedded webviews.
 *  2. `localStorage` exists and **throws on access**. A cross-origin sandboxed
 *     iframe throws a SecurityError from the *getter*, before any method is
 *     called, so a `typeof` check alone is not enough and the whole access has
 *     to sit inside the try.
 *
 * `App.tsx`'s theme hook reads storage unguarded and would throw on boot in
 * case 2. This is the fix for it when someone gets to it.
 */

/**
 * Read a remembered value, but only if it is still one of the allowed ones.
 *
 * The allowlist is not decoration. A stale key from an older release, or a
 * value someone typed into devtools, would otherwise flow straight into a
 * query string — and an unsupported `sort=` is a 400 from the API on first
 * paint. Anything unrecognised is treated as nothing remembered.
 */
export function readPref<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw !== null && raw !== undefined && (allowed as readonly string[]).includes(raw)
      ? raw as T
      : null;
  } catch {
    return null;
  }
}

/**
 * Remember a value, or fail silently.
 *
 * Silent because there is no useful thing to tell someone whose browser
 * refuses storage: the page works, and their choice lasts until they leave.
 * A thrown quota or security error here must never reach a click handler.
 */
export function writePref(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* Storage unavailable or full. The page does not depend on this. */
  }
}
