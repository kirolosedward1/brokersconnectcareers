import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';
import { ENGLISH_ENABLED } from '@/i18n/routing';

/** Private surfaces and anything whose URL carries a signed token. */
const PRIVATE = ['/dashboard', '/employer', '/admin', '/notifications', '/onboarding', '/auth', '/api'];

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
const VIEW_PARAMS = [
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

export default function robots(): MetadataRoute.Robots {
  const privatePaths = ENGLISH_ENABLED
    ? [...PRIVATE, ...PRIVATE.filter((path) => path !== '/auth' && path !== '/api').map((path) => `/en${path}`)]
    : PRIVATE;

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        ...privatePaths,
        // The apply step: a sign-in wall for a crawler, one per listing.
        '/jobs/*/apply',
        ...VIEW_PARAMS.flatMap((param) => [`/*?${param}=`, `/*?*&${param}=`]),
      ],
    },
    sitemap: `${env.siteUrl}/sitemap.xml`,
  };
}
