import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  /**
   * `pnpm build` and `pnpm dev` share .next by default, so running a
   * production build while the dev server is up deletes the chunks the dev
   * server is still serving. Every page then 500s with "Cannot find module
   * ./9755.js", which reads exactly like a broken application and is not one.
   *
   * Set NEXT_DIST_DIR to give one of them somewhere else to live. Unset — which
   * is every CI run and every deploy — nothing changes.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  /**
   * The blog is read off disk at request time, and Next only bundles files it
   * can see being read. It resolves content/blog for the blog routes, where the
   * slug comes from generateStaticParams, but not for the sitemap, which just
   * asks the directory what is in it.
   *
   * Untraced, that directory is absent from the deployed function: readdirSync
   * throws, getPostSlugs returns [], and every post quietly falls out of the
   * sitemap on the first revalidation after deploy. Production was doing this —
   * five URLs where there should have been seven.
   */
  outputFileTracingIncludes: {
    '/sitemap.xml': ['./content/**/*'],
    // The legal pages read their markdown off disk at request time, same as the
    // blog. Traced explicitly rather than trusted to inference, because these
    // two are linked from the footer of every page on the site.
    '/[locale]/(site)/privacy': ['./content/legal/**/*'],
    '/[locale]/(site)/terms': ['./content/legal/**/*'],
  },
  images: {
    remotePatterns: [
      // Supabase Storage public buckets (company logos).
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
    ],
  },
};

export default withNextIntl(nextConfig);
