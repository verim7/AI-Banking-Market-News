import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../src/csv.ts';

describe('csvCell', () => {
  it('quotes fields containing commas, quotes or newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises a formula so Excel does not execute a headline', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('=cmd|calc')).toBe("'=cmd|calc");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('quotes a leading-minus value after neutralising it', () => {
    expect(csvCell('-1,5')).toBe(`"'-1,5"`);
  });

  it('renders empty for null and undefined', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('starts with a BOM so Excel reads UTF-8 correctly', () => {
    expect(toCsv(['A'], [['Zürich']]).charCodeAt(0)).toBe(0xfeff);
  });

  it('uses CRLF line endings as RFC 4180 requires', () => {
    expect(toCsv(['A', 'B'], [['1', '2']])).toBe('﻿A,B\r\n1,2\r\n');
  });
});
