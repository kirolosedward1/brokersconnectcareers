import type { MetadataRoute } from 'next';

/**
 * The web app manifest.
 *
 * Not an attempt at a PWA — there is no service worker and no offline story,
 * and pretending otherwise would be worse than nothing. What this buys is what
 * a phone actually reads it for: a name and an icon when somebody adds the
 * site to their home screen, and a theme colour so the browser chrome stops
 * being default grey above an otherwise branded page. In a market that is
 * overwhelmingly mobile, that is the whole of it.
 *
 * Arabic only, and start_url is `/` rather than `/ar`: the locale prefix is
 * `as-needed`, so Arabic lives at the root and `/ar` merely redirects there.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'بروكرز كونكت — سوق الوظائف المتخصص في العقارات المصرية',
    short_name: 'بروكرز كونكت',
    description:
      'وظائف البيع والتسويق العقاري في مصر — رواتب أساسية وعمولات واضحة، ومصدر العملاء مذكور في كل إعلان.',
    start_url: '/',
    display: 'standalone',
    dir: 'rtl',
    lang: 'ar',
    background_color: '#ffffff',
    theme_color: '#1a3fd4',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
