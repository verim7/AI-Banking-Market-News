import { describe, expect, it } from 'vitest';
import { sqlLiteral } from '../src/sql.ts';

const NUL = String.fromCharCode(0);
const BELL = String.fromCharCode(7);

describe('sqlLiteral', () => {
  it('doubles single quotes', () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
  });

  it('neutralises an attempted statement break', () => {
    expect(sqlLiteral("'; DROP TABLE articles; --"))
      .toBe("'''; DROP TABLE articles; --'");
  });

  it('leaves backslashes alone, since SQLite has no backslash escape', () => {
    expect(sqlLiteral('a\\b')).toBe("'a\\b'");
  });

  it('strips NUL and other control characters', () => {
    expect(sqlLiteral(`a${NUL}b${BELL}c`)).toBe("'abc'");
  });

  it('keeps newlines and tabs, which are legal in SQLite literals', () => {
    expect(sqlLiteral('a\nb\tc')).toBe("'a\nb\tc'");
  });

  it('keeps non-ASCII text intact', () => {
    expect(sqlLiteral('Zürich Bank')).toBe("'Zürich Bank'");
  });

  it('renders null, undefined, numbers and booleans', () => {
    expect(sqlLiteral(null)).toBe('NULL');
    expect(sqlLiteral(undefined)).toBe('NULL');
    expect(sqlLiteral(42.5)).toBe('42.5');
    expect(sqlLiteral(Number.NaN)).toBe('NULL');
    expect(sqlLiteral(true)).toBe('1');
  });
});
