import { OPERATOR } from '@/lib/business';

/**
 * The name Google should print beside the favicon.
 *
 * The Arabic name is an alternateName, not this one: the site name in Search
 * is the brand as written in Latin, and "بروكرز كونكت" is how the same brand
 * is searched and titled in Arabic.
 */
export const SITE_NAME = 'Brokers Connect';
export const SITE_ALTERNATE_NAMES = ['بروكرز كونكت', 'brokersconnect.net'] as const;
/** Square brand mark, 450×450, already larger than Google's 112px logo floor. */
export const LOGO_PATH = '/brand/logo-mark.png';

function originOf(siteUrl: string): string {
  return siteUrl.replace(/\/$/, '');
}

/**
 * The organisation behind the site.
 *
 * sameAs is omitted on purpose. No official social profile is published in
 * this repo, and the site's own URL is not a profile on another site.
 */
export function organizationJsonLd(siteUrl: string): Record<string, unknown> {
  const origin = originOf(siteUrl);
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: `${origin}/`,
    logo: `${origin}${LOGO_PATH}`,
    email: OPERATOR.email,
    contactPoint: {
      '@type': 'ContactPoint',
      email: OPERATOR.email,
      contactType: 'customer support',
      availableLanguage: ['Arabic', 'English'],
    },
  };
}

/** The site, plus the board search, which is a real `?q=` on /jobs. */
export function websiteJsonLd(siteUrl: string): Record<string, unknown> {
  const origin = originOf(siteUrl);
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    alternateName: [...SITE_ALTERNATE_NAMES],
    url: `${origin}/`,
    inLanguage: 'ar',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${origin}/jobs?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

function isAbsoluteHttp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * What is wrong with the WebSite payload, against schema.org and the
 * SearchAction shape Google documents for a sitelinks search box.
 * Empty means valid.
 */
export function websiteProblems(data: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (data['@context'] !== 'https://schema.org') problems.push('@context');
  if (data['@type'] !== 'WebSite') problems.push('@type');
  if (data.name !== SITE_NAME) problems.push('name');
  const alt = data.alternateName;
  if (
    !Array.isArray(alt) ||
    alt.length !== SITE_ALTERNATE_NAMES.length ||
    SITE_ALTERNATE_NAMES.some((name, index) => alt[index] !== name)
  ) {
    problems.push('alternateName');
  }
  if (!isAbsoluteHttp(data.url) || !data.url.endsWith('/')) problems.push('url');
  if ('sameAs' in data) problems.push('sameAs');

  const action = data.potentialAction;
  if (!action || typeof action !== 'object') {
    problems.push('potentialAction');
    return problems;
  }
  const search = action as Record<string, unknown>;
  if (search['@type'] !== 'SearchAction') problems.push('SearchAction');
  const target = search.target;
  if (!target || typeof target !== 'object') {
    problems.push('target');
  } else {
    const entry = target as Record<string, unknown>;
    if (entry['@type'] !== 'EntryPoint') problems.push('EntryPoint');
    if (
      typeof entry.urlTemplate !== 'string' ||
      !entry.urlTemplate.endsWith('/jobs?q={search_term_string}') ||
      !isAbsoluteHttp(entry.urlTemplate.split('?')[0] ?? '')
    ) {
      problems.push('urlTemplate');
    }
  }
  if (search['query-input'] !== 'required name=search_term_string') problems.push('query-input');
  return problems;
}

/**
 * What is wrong with the Organization payload.
 *
 * Google's logo rule: an absolute URL of a square image, crawlable, at least
 * 112px. The dimensions themselves are checked against the file in the test.
 */
export function organizationProblems(data: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (data['@context'] !== 'https://schema.org') problems.push('@context');
  if (data['@type'] !== 'Organization') problems.push('@type');
  if (data.name !== SITE_NAME) problems.push('name');
  if (!isAbsoluteHttp(data.url)) problems.push('url');
  if (!isAbsoluteHttp(data.logo) || !data.logo.endsWith(LOGO_PATH)) problems.push('logo');
  if ('sameAs' in data) problems.push('sameAs');
  if (data.email !== OPERATOR.email) problems.push('email');

  const contact = data.contactPoint;
  if (!contact || typeof contact !== 'object') {
    problems.push('contactPoint');
  } else {
    const point = contact as Record<string, unknown>;
    if (point['@type'] !== 'ContactPoint') problems.push('contactPoint.@type');
    if (point.email !== 'info@topsuite.net') problems.push('contactPoint.email');
    if (typeof point.contactType !== 'string' || !point.contactType) problems.push('contactType');
  }
  return problems;
}
