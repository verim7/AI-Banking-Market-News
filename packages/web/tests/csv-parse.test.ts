import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/lib/csv-parse.ts';
import { toCsv } from '../../worker/src/csv.ts';

describe('reading back what the Worker writes', () => {
  // The strongest test available: generate with the real encoder, read with
  // this parser. If they ever disagree about quoting, this fails rather than a
  // user's spreadsheet looking wrong.
  it('round-trips every shape the encoder produces', () => {
    const headers = ['Title', 'Note', 'Source'];
    const rows = [
      ['Plain text', 'nothing special', 'Reuters'],
      ['Has, a comma', 'and "quotes" inside', 'FT'],
      ['Line\nbreak', 'tab\tcharacter', 'Handelsblatt'],
      ['Zürich, Genève', 'accents é ü ö', 'Agefi'],
      ['', '', ''],
    ];
    expect(parseCsv(toCsv(headers, rows))).toEqual([headers, ...rows]);
  });

  it('strips the BOM instead of gluing it to the first heading', () => {
    // The Worker prefixes a UTF-8 BOM so Excel renders "Zürich" correctly.
    const parsed = parseCsv(toCsv(['Title'], [['x']]));
    expect(parsed[0]?.[0]).toBe('Title');
  });

  it('keeps the formula guard the encoder applies', () => {
    // csv.ts prefixes a quote to anything starting with = + - @ so Excel does
    // not execute a news headline as a formula. The reader must not undo it.
    const parsed = parseCsv(toCsv(['Title'], [['=1+1']]));
    expect(parsed[1]?.[0]).toBe("'=1+1");
  });
});

describe('the awkward cases a CSV reader has to get right', () => {
  it('tells an empty field from an empty quoted field', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
    expect(parseCsv('a,"",c')).toEqual([['a', '', 'c']]);
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsv('"she said ""hi"""')).toEqual([['she said "hi"']]);
  });

  it('keeps a comma and a newline that live inside quotes', () => {
    expect(parseCsv('"a,b","c\nd"')).toEqual([['a,b', 'c\nd']]);
  });

  it('accepts both line endings', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('does not invent a trailing empty row', () => {
    expect(parseCsv('a,b\r\n')).toEqual([['a', 'b']]);
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
  });

  it('returns nothing for nothing', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('runs in one pass, so no input can make it hang', () => {
    // The ReDoS this replaces is what a regex over untrusted text buys you.
    // 200k quotes would be catastrophic for a backtracking pattern; a single
    // character-by-character pass finishes immediately.
    const nasty = `"${'"'.repeat(200_000)}"`;
    const started = Date.now();
    parseCsv(nasty);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
