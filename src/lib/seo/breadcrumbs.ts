import { env } from '@/lib/env';

/**
 * schema.org BreadcrumbList for a trail that is already visible on the page.
 *
 * Paths are the unprefixed ones the page links to; while only Arabic is
 * published that is also the canonical URL. The last crumb is the page itself
 * and carries no `item`, which is how Google's documentation marks the
 * current page.
 */
export function breadcrumbJsonLd(
  crumbs: { name: string; path?: string }[],
  locale: string,
): Record<string, unknown> {
  const prefix = locale === 'ar' ? '' : `/${locale}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      ...(crumb.path ? { item: `${env.siteUrl}${prefix}${crumb.path === '/' && prefix ? '' : crumb.path}` } : {}),
    })),
  };
}
