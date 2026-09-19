import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * react and react-dom are one library shipped as two packages.
 *
 * They talk to each other through an object literally named
 * `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED`, whose shape changes
 * between majors without notice. A tree holding react 19 and react-dom 18
 * therefore builds, typechecks and passes every unit test, and then throws on
 * the first line `createRoot` runs — which is how this project shipped a black
 * page: Dependabot raised react alone, and nothing downstream objected.
 *
 * The browser check in `npm run smoke:web` catches the symptom. This catches
 * the cause, in milliseconds, without a browser, and names it.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative: string) => JSON.parse(readFileSync(join(root, relative), 'utf8'));

const major = (version: string) => {
  const match = /(\d+)/.exec(version);
  if (!match) throw new Error(`Not a version: ${version}`);
  return match[1];
};

describe('react and react-dom stay on the same major', () => {
  it('is what packages/web asks for', () => {
    const { dependencies, devDependencies } = read('packages/web/package.json');

    expect(major(dependencies['react-dom'])).toBe(major(dependencies.react));
    // The types are a separate pair with the same failure mode: @types/react 19
    // beside @types/react-dom 18 breaks `createRoot`'s signature rather than
    // the runtime, which is the same bug one layer up.
    expect(major(devDependencies['@types/react-dom'])).toBe(major(devDependencies['@types/react']));
    expect(major(devDependencies['@types/react'])).toBe(major(dependencies.react));
  });

  it('is what the lockfile actually installs', () => {
    // The ranges above can agree while the tree does not: npm leaves an older
    // copy in place when nothing forces it out, and a second React anywhere in
    // the tree means two dispatchers and "invalid hook call" at runtime. So
    // this asserts on the resolved tree, which is what `npm ci` reproduces
    // byte for byte in CI.
    const { packages } = read('package-lock.json') as {
      packages: Record<string, { version?: string }>;
    };

    const copiesOf = (name: string) => Object.entries(packages)
      .filter(([path]) => path.endsWith(`node_modules/${name}`))
      .map(([path, entry]) => ({ path, version: entry.version ?? '?' }));

    const react = copiesOf('react');
    const reactDom = copiesOf('react-dom');
    const where = (copies: { path: string; version: string }[]) =>
      copies.map((c) => `${c.path}@${c.version}`).join(', ');

    expect(react.length, `expected one react, found: ${where(react)}`).toBe(1);
    expect(reactDom.length, `expected one react-dom, found: ${where(reactDom)}`).toBe(1);
    expect(major(reactDom[0]!.version)).toBe(major(react[0]!.version));
  });
});
