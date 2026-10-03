/*
  No imports: robots.ts serves these rules, and scripts/robots.test.mjs runs
  this file directly to ask what each rule actually keeps out.
*/

/**
 * Private surfaces and anything whose URL carries a signed token.
 *
 * A rule is a prefix, not a path segment, so `/employer` alone also kept out
 * `/employers` — the public page for companies, in the sitemap — and every
 * crawler obeyed. The console is named three ways instead: itself (`$` ends
 * the match, as Google and Bing read it), everything under it, and itself
 * with a query.
 *
 * Not `/agents`, though the directory has been behind a sign-in since
 * migration 322. Its profile URLs used to carry a consultant's name (migration
 * 202 renamed them), and some were indexed while profiles were public. A
 * crawler kept out by robots.txt never sees that they now redirect a visitor
 * to a noindex sign-in page, so a search engine keeps listing them, name and
 * all, for good. Let in, it sees the redirect and drops them; the pages
 * themselves are noindex anyway.
 */
export const PRIVATE = [
  '/dashboard',
  '/employer$',
  '/employer/',
  '/employer?',
  '/admin',
  '/notifications',
  '/onboarding',
  '/auth',
  '/api',
];

/**
 * Query parameters that only ever produce a view of a list page.
 *
 * Every one of these pages already answers `noindex, follow`, but noindex is
 * read only after the page is fetched — it stops indexing, not crawling. The
 * board alone takes a free-text query, a sort and eight multi-value filters,
 * and a crawler that follows the combinations spends its visit on them
 * instead of on listings. Google's guidance for faceted navigation that does
 * not need to be indexed is to keep it out of the crawl with robots.txt.
 *
 * Left crawlable on purpose:
 *   track, district — linked from every footer and the home page; single
 *     values lead a crawler to listings, and they stay noindex.
 *   page — the unfiltered board's pagination is a path to every listing.
 *
 * `*` in a rule is Google's and Bing's wildcard; `?*name=` matches the
 * parameter anywhere in the query string.
 */
export const VIEW_PARAMS = [
  'q', // free-text search, on the board and the company directory
  'sort',
  'leads',
  'exp',
  'type',
  'ctype',
  'salary',
  'gov',
  'company', // one company's roles — the company page is the indexable version
  'verified',
  'availability',
  'years',
];

/**
 * Every `Allow:` line. A crawler takes the longest rule that matches (RFC
 * 9309; Allow wins a tie), so these let through what a shorter Disallow would
 * otherwise catch:
 *
 *   /_next/image — Next's image optimiser, every logo and picture on the site:
 *     `/_next/image?url=…&w=64&q=75`. Its `q` is the image's quality, but
 *     `/*?*&q=` above cannot tell, and kept crawlers off every image while
 *     they rendered the pages, logos out of image search with them.
 */
export const ALLOW = ['/', '/_next/image'];

/** Every `Disallow:` line robots.txt carries, in order. */
export function disallowRules(englishEnabled: boolean): string[] {
  const privatePaths = englishEnabled
    ? [...PRIVATE, ...PRIVATE.filter((path) => path !== '/auth' && path !== '/api').map((path) => `/en${path}`)]
    : PRIVATE;
  return [
    ...privatePaths,
    // The apply step: a sign-in wall for a crawler, one per listing.
    '/jobs/*/apply',
    ...(englishEnabled ? ['/en/jobs/*/apply'] : []),
    ...VIEW_PARAMS.flatMap((param) => [`/*?${param}=`, `/*?*&${param}=`]),
  ];
}

/**
 * Whether a crawler reading these rules leaves `pathAndQuery` alone — as
 * Google matches them (RFC 9309): from the start of the path, `*` standing
 * for any run of characters and a final `$` for the end of the URL. The
 * longest rule that matches decides, and an Allow as long as a Disallow wins.
 */
export function isDisallowed(pathAndQuery: string, disallow: string[], allow: string[] = ALLOW): boolean {
  const longest = (rules: string[]) =>
    rules.reduce((best, rule) => (rule.length > best && matches(rule, pathAndQuery) ? rule.length : best), -1);
  return longest(disallow) > longest(allow);
}

function matches(rule: string, pathAndQuery: string): boolean {
  const anchored = rule.endsWith('$');
  const body = (anchored ? rule.slice(0, -1) : rule)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(pathAndQuery);
}
