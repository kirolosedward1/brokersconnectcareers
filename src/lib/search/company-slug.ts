/**
 * The one job-board filter whose value is a free string.
 *
 * Every other filter on the board is a member of a fixed list — a track, a
 * band, a district slug checked against the taxonomy — so an unknown value
 * simply drops out. `?company=` cannot be checked that way without a round
 * trip, and the value does not stop at the query: it is stored in a saved
 * search and replayed a week later by a cron job running as nobody. A shape
 * nothing can forge is one less thing to reason about at that distance.
 *
 * Slugs here are ASCII by construction — `slugify` transliterates Arabic and
 * keeps `[a-z0-9-]` — so anything else is somebody experimenting with the
 * address bar, and the honest answer is "no filter", not an error page.
 *
 * Its own file, with no imports, for the same reason as `needle.ts`:
 * everything in `queries/` pulls in the server client and `server-only`, and
 * the test suite cannot reach any of it.
 */
const SLUG = /^[a-z0-9-]{1,80}$/;

export function companySlugOrNull(value: string | string[] | undefined): string | null {
  // A repeated `?company=a&company=b` arrives as an array. Two companies is
  // not a narrower question than one, it is an unanswerable one.
  const slug = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SLUG.test(slug) ? slug : null;
}
