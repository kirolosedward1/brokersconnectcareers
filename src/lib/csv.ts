/**
 * A spreadsheet file from rows of words: the team's activity (Phase B 04),
 * and whatever else is exported next. Shared by the website and the app.
 *
 * - A byte-order mark first, so Excel reads Arabic as UTF-8 rather than as
 *   Latin-1 mojibake.
 * - CRLF between rows, as RFC 4180 has it.
 * - A cell is quoted when it holds a comma, a quote or a line break, with its
 *   quotes doubled.
 * - A cell that begins as a formula would (= + - @, a tab or a carriage
 *   return) gets an apostrophe first. A candidate's name is typed by the
 *   candidate, and a spreadsheet must not run it.
 */
export const CSV_BOM = '﻿';

const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return CSV_BOM + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
