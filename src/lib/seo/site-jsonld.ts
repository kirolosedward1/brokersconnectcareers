import { OPERATOR } from '@/lib/business';

/**
 * The site itself, on every page.
 *
 * sameAs is only the canonical origin. No social profile, app-store listing
 * or other official URL is published in this repo, and inventing one would
 * point Google at a page we do not run.
 */
export function organizationJsonLd(siteUrl: string, name: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url: siteUrl,
    logo: `${siteUrl}/brand/logo-mark.png`,
    email: OPERATOR.email,
    sameAs: [siteUrl],
    contactPoint: {
      '@type': 'ContactPoint',
      email: OPERATOR.email,
      contactType: 'customer support',
      availableLanguage: ['Arabic', 'English'],
    },
  };
}

/** The site, plus the board search, which is a real `?q=` on /jobs. */
export function websiteJsonLd(siteUrl: string, name: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name,
    url: siteUrl,
    inLanguage: 'ar',
    potentialAction: {
      '@type': 'SearchAction',
      target: `${siteUrl}/jobs?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}
