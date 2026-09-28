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
