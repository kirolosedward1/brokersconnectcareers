import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Private surfaces and anything whose URL carries a signed token.
      disallow: [
        '/dashboard',
        '/employer',
        '/admin',
        '/notifications',
        '/onboarding',
        // A directory of people, behind a sign-in since migration 68.
        '/agents',
        '/auth',
        '/api',
      ],
    },
    sitemap: `${env.siteUrl}/sitemap.xml`,
    host: env.siteUrl,
  };
}
