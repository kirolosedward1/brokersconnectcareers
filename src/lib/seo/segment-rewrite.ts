/**
 * Which internal page a public URL is drawn from.
 *
 * The address stays the public one. GET and POST both use this: a server
 * action is a POST to the page that rendered the button, and leaving POST on
 * the cached segment runs the action against the landing instead of the
 * listing, the signed-in home, or the filtered board.
 *
 * `landing` is false only when the slug is definitely not a track-in-district
 * page. Null means the lookup did not answer, and the public segment keeps
 * the request so it can fail open.
 */
export function segmentRewrite(
  path: string,
  search: string,
  signedIn: boolean,
  landing: boolean | null,
): string | null {
  if (signedIn && path === '/') return '/signed-home';
  if (path === '/jobs' && search.length > 1) return '/board';
  const jobAd = path.match(/^\/jobs\/([^/]+)$/);
  if (jobAd && landing === false) return `/listing/${jobAd[1]}`;
  return null;
}
