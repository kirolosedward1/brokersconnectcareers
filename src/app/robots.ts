import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';
import { ENGLISH_ENABLED } from '@/i18n/routing';
import { disallowRules } from '@/lib/seo/robots-rules';

/**
 * What crawlers are kept out of, and where the sitemap is. The rules, and why
 * each is there, are in lib/seo/robots-rules.ts, where
 * scripts/robots.test.mjs checks that none of them keeps out a page the
 * sitemap lists.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: disallowRules(ENGLISH_ENABLED),
    },
    sitemap: `${env.siteUrl}/sitemap.xml`,
  };
}
