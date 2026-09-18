/**
 * A small RFC 4180 reader, written to remove the one reachable path to a
 * known vulnerability.
 *
 * `npm audit` flags `xlsx` (SheetJS) for prototype pollution and a ReDoS, and
 * there is no fixed version on npm — the package was abandoned there. Both
 * advisories are against the **parser**, `XLSX.read`. The writer side
 * (`utils.aoa_to_sheet`, `write`) is not implicated.
 *
 * The HIL export used to call `XLSX.read()` on the CSV the Worker returns, and
 * that made the vulnerability reachable by a longer route than it first looks:
 * the CSV is built from article titles and source names, which come from
 * third-party RSS feeds. A publisher headline is attacker-influenced text, and
 * it reached a vulnerable parser.
 *
 * So the parser is gone and this replaces it. The input is not arbitrary
 * spreadsheet data — it is the output of `packages/worker/src/csv.ts`, one
 * known format, which is why twenty lines suffice where a library would not.
 */

/**
 * Split CSV text into rows of fields.
 *
 * Character by character rather than by regex, deliberately: the ReDoS this
 * replaces is what a clever regex over untrusted text buys you. A single pass
 * with no backtracking cannot blow up on any input.
 *
 * Handles what `toCsv` emits and what Excel produces: quoted fields, embedded
 * commas and newlines, and `""` as an escaped quote. CRLF and LF both end a
 * row. A trailing newline does not produce a phantom empty row.
 */
export function parseCsv(text: string): string[][] {
  // The Worker prefixes a UTF-8 BOM so Excel renders "Zürich" correctly. It is
  // a byte-order mark, not data, and would otherwise become part of the first
  // header cell.
  const input = text.replace(/^﻿/, '');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;   // distinguishes "" from an empty unquoted field

  const endField = () => { row.push(field); field = ''; started = false; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }  // escaped quote
        else quoted = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && !started) { quoted = true; started = true; continue; }
    if (ch === ',') { endField(); continue; }
    if (ch === '\r') { if (input[i + 1] === '\n') i++; endRow(); continue; }
    if (ch === '\n') { endRow(); continue; }

    field += ch;
    started = true;
  }

  // A file ending in a newline has already closed its last row; anything left
  // in the buffer is a final row without a terminator.
  if (field !== '' || started || row.length > 0) endRow();

  return rows;
}
