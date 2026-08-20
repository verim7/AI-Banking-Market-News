/**
 * SQLite literal quoting.
 *
 * The D1 HTTP API binds parameters for a single statement only, and this job
 * writes hundreds of rows per run — one request per row would be both slow and
 * wasteful of the free-tier request budget. So statements are batched, which
 * means values are inlined and must be quoted correctly here.
 *
 * SQLite string literals have exactly one escape: a single quote is written
 * twice. There is no backslash escape, so doubling quotes is complete. NUL and
 * other control characters are stripped because SQLite treats NUL as a string
 * terminator and feeds occasionally carry them. Tab, newline and carriage
 * return are kept — they are legal inside a literal and dropping them would
 * corrupt the text.
 */

const TAB = 9;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const SPACE = 32;
const DELETE = 127;

function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    const printable = code >= SPACE && code !== DELETE;
    if (printable || code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN) {
      out += ch;
    }
  }
  return out;
}

export function sqlLiteral(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'boolean') return value ? '1' : '0';

  return `'${stripControlChars(value).replace(/'/g, "''")}'`;
}
