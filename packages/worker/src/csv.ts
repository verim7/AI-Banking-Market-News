/**
 * RFC 4180 CSV.
 *
 * Excel is the destination, so two details matter beyond the RFC: a UTF-8 BOM,
 * without which Excel mangles "Zürich"; and quoting any field that begins with
 * =, +, - or @, which Excel would otherwise execute as a formula. The second is
 * a real injection risk when the text comes from arbitrary news headlines.
 */

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);

  if (FORMULA_PREFIXES.some((p) => s.startsWith(p))) s = `'${s}`;

  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
