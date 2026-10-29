/**
 * A listing opened from a forwarded link (`?src=share`, the website's share
 * marker): noted as the link is read (links.ts drops the marker from the
 * path), and taken once by the listing it opened, for the funnel's first
 * step (arrived_from_share). In memory only, and only the slug.
 */
const arrived = new Set<string>();

export function noteSharedArrival(pathname: string, params: URLSearchParams) {
  if (params.get('src') !== 'share') return;
  const slug = /^\/jobs\/([^/]+)$/.exec(pathname)?.[1];
  if (slug) arrived.add(slug.toLowerCase());
}

/** Whether this listing was opened from a share, the first time it asks. */
export function takeSharedArrival(slug: string): boolean {
  return arrived.delete(slug.toLowerCase());
}
