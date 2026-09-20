import { afterEach, describe, expect, it } from 'vitest';
import { readPref, writePref } from '../src/lib/prefs.ts';

/**
 * These run in Node, where `localStorage` does not exist at all — which is not
 * a limitation of the test, it is the first case the code has to survive. The
 * stubs below add storage back for the cases that need it, and remove it again
 * so the absent case stays the default.
 */
const ALLOWED = ['published', 'aiIntensity'] as const;

function stubStorage(impl: Partial<Storage>): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: impl, configurable: true, writable: true,
  });
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('remembering a choice', () => {
  it('reports nothing remembered when there is no storage at all', () => {
    // Node, and some embedded webviews. The caller falls back to its default.
    expect(readPref('lens.sort.v1:global', ALLOWED)).toBeNull();
  });

  it('does not throw when storage itself throws on access', () => {
    // A sandboxed cross-origin iframe throws a SecurityError from the getter,
    // before any method is called — so a typeof check alone would not save us.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError: access denied'); },
    });
    expect(() => readPref('k', ALLOWED)).not.toThrow();
    expect(readPref('k', ALLOWED)).toBeNull();
    expect(() => writePref('k', 'published')).not.toThrow();
  });

  it('returns a remembered value that is still allowed', () => {
    const store = new Map([['lens.sort.v1:global', 'aiIntensity']]);
    stubStorage({ getItem: (k) => store.get(k) ?? null });
    expect(readPref('lens.sort.v1:global', ALLOWED)).toBe('aiIntensity');
  });

  it('ignores a value that is not on the allowlist', () => {
    // The reason the allowlist exists: a key left over from an older release,
    // or one typed into devtools, would otherwise go straight into `sort=` and
    // the API would answer the first paint with a 400.
    const store = new Map([['lens.sort.v1:global', 'promiseSquared']]);
    stubStorage({ getItem: (k) => store.get(k) ?? null });
    expect(readPref('lens.sort.v1:global', ALLOWED)).toBeNull();
  });

  it('treats an empty string as nothing remembered', () => {
    stubStorage({ getItem: () => '' });
    expect(readPref('k', ALLOWED)).toBeNull();
  });

  it('round-trips through a working store', () => {
    const store = new Map<string, string>();
    stubStorage({
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => { store.set(k, v); },
    });
    writePref('lens.sort.v1:global', 'published');
    expect(readPref('lens.sort.v1:global', ALLOWED)).toBe('published');
  });

  it('swallows a storage write that fails', () => {
    // Safari in private mode used to throw QuotaExceededError on every write.
    // A click handler must not carry that to the user.
    stubStorage({ setItem: () => { throw new Error('QuotaExceededError'); } });
    expect(() => writePref('k', 'published')).not.toThrow();
  });
});
