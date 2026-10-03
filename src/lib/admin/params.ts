/**
 * The console's list pages keep their whole state in the query string —
 * filter, search, page — so every view is a URL somebody can bookmark or send
 * to a colleague, and the back button does what it says.
 */

export const PAGE_SIZE = 25;

export type SearchParams = Record<string, string | string[] | undefined>;

export function param(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  const one = Array.isArray(value) ? value[0] : value;
  const trimmed = one?.trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

/** One of an allowed set, or the fallback — never whatever was typed into the URL. */
export function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}

export function pageOf(params: SearchParams): number {
  const n = Number.parseInt(param(params, 'page') ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 1;
}

/** The range PostgREST's .range() takes, for a 1-based page. */
export function rangeOf(page: number, size = PAGE_SIZE): [number, number] {
  const from = (page - 1) * size;
  return [from, from + size - 1];
}

/**
 * Where a page that came back empty should send somebody, or null to stay.
 *
 * An empty first page is the answer: nothing is waiting. An empty later page
 * is the end of the list moving under the URL — the last case on the last page
 * resolved, and the page refreshed where it was — and showing it said "nothing
 * waiting" over a page one still full of work. PostgREST refuses an offset
 * past the total (PGRST103) but answers an offset of exactly the total with no
 * rows, and a database function paging with limit/offset counts its total
 * over the rows it returns, so an empty page reads as a total of 0. So: the
 * last page the total says has rows, or the first when the total is not known
 * — never this page or a later one, so following it always ends.
 */
export function pageAfterTheEnd({
  page,
  rows,
  total,
  size = PAGE_SIZE,
}: {
  page: number;
  rows: number;
  total: number | null | undefined;
  size?: number;
}): number | null {
  if (page <= 1 || rows > 0) return null;
  const last = Math.ceil((total ?? 0) / size);
  return Math.max(1, Math.min(last, page - 1));
}

/**
 * A path with the current query, some keys replaced. An empty or undefined
 * value removes the key, and changing anything but `page` resets to page one,
 * because page four of a different filter is not a place anybody meant to go.
 */
export function hrefWith(
  path: string,
  current: Record<string, string | undefined>,
  changes: Record<string, string | number | undefined>,
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (value) next.set(key, value);
  }
  if (!('page' in changes)) next.delete('page');
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === '' || (key === 'page' && Number(value) <= 1)) next.delete(key);
    else next.set(key, String(value));
  }
  const query = next.toString();
  return query ? `${path}?${query}` : path;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A calendar day from the query string (YYYY-MM-DD), or undefined. */
export function dayOf(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  // A day that exists: 2026-02-30 parses, as 2 March, so it must round-trip.
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

/**
 * The instant a calendar day begins in Cairo — the day a moderator means when
 * they filter by date — with `plusDays` for the exclusive end of a range.
 * Egypt keeps summer time, so the offset is asked of the time zone database
 * for that day rather than assumed.
 */
export function cairoDayStart(day: string, plusDays = 0): string {
  const noon = new Date(`${day}T12:00:00Z`);
  noon.setUTCDate(noon.getUTCDate() + plusDays);
  const date = noon.toISOString().slice(0, 10);
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', timeZoneName: 'longOffset' })
      .formatToParts(noon)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+02:00';
  const match = /GMT([+-]\d{2}):?(\d{2})?/.exec(name);
  const offset = match ? `${match[1]}:${match[2] ?? '00'}` : '+02:00';
  return new Date(`${date}T00:00:00${offset}`).toISOString();
}
