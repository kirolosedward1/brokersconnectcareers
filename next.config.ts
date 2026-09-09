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
  /**
   * Security headers.
   *
   * Production was sending exactly one — Vercel's HSTS. Everything below is
   * absent by default in Next, so it has to be asked for.
   *
   * The CSP here is deliberately the part that cannot break this application,
   * and deliberately stops short of the part that can. `script-src` still
   * carries 'unsafe-inline' because Next's bootstrap is an inline script, and
   * removing that needs a per-request nonce threaded through the middleware
   * and `strict-dynamic` — real work, and work that has to be exercised in a
   * browser before it ships, because the failure mode is a blank page.
   *
   * What is here is still worth having. `object-src 'none'` and
   * `base-uri 'self'` close two injection routes outright; `form-action 'self'`
   * means a stored-XSS payload cannot post a candidate's details to another
   * origin; `frame-ancestors 'none'` is clickjacking, which matters on a site
   * whose primary action is a one-click apply button.
   *
   * The hosts are derived rather than typed out, so a different Supabase
   * project or analytics provider does not silently get blocked.
   */
  async headers() {
    const supabase = (() => {
      try {
        return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin;
      } catch {
        return '';
      }
    })();

    const analytics = (() => {
      try {
        return process.env.NEXT_PUBLIC_ANALYTICS_SRC
          ? new URL(process.env.NEXT_PUBLIC_ANALYTICS_SRC).origin
          : '';
      } catch {
        return '';
      }
    })();

    const csp = [
      `default-src 'self'`,
      // Next inlines its bootstrap; see the note above about nonces.
      `script-src 'self' 'unsafe-inline' ${analytics}`.trim(),
      // Tailwind ships as a stylesheet, but Next also inlines critical CSS.
      `style-src 'self' 'unsafe-inline'`,
      // Company logos come from Supabase storage; avatars come from whichever
      // identity provider the account signed in with, so https: is the honest
      // bound rather than a list that breaks the next provider added.
      `img-src 'self' data: blob: https:`,
      `media-src 'self'`,
      `font-src 'self' data:`,
      // The websocket origin as well as the https one: supabase-js opens a
      // realtime socket even where the application does not subscribe to
      // anything, and a blocked socket is a console error on every page.
      `connect-src 'self' ${supabase} ${supabase.replace(/^https:/, 'wss:')} ${analytics}`.trim(),
      `object-src 'none'`,
      `base-uri 'self'`,
      `form-action 'self'`,
      `frame-ancestors 'none'`,
      /*
        No `upgrade-insecure-requests`.

        It rewrites every http:// request to https://, which is a no-op in
        production — Vercel serves TLS only and the HSTS header already stops
        the browser attempting http at all — and actively harmful anywhere
        else. With it on, `next start` over plain http answered every RSC
        navigation with ERR_SSL_PROTOCOL_ERROR and fell back to a full page
        load, which is how this was found: the app still worked and quietly
        lost client-side routing.
      */
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Referrers leak paths, and a path here can name a job, a company or
          // a candidate's profile slug.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
          },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
    ];
  },

  images: {
    remotePatterns: [
      // Supabase Storage public buckets (company logos).
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
    ],
  },
};

export default withNextIntl(nextConfig);
