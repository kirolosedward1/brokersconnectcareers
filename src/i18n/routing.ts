import { defineRouting } from 'next-intl/routing';
import { defaultLocale, locales } from '@/lib/locale';

/*
  The locale facts themselves live in @/lib/locale, which imports nothing, so
  the mobile app can read them without loading next-intl. Everything the web
  imported from here is still importable from here.
*/
export * from '@/lib/locale';

export const routing = defineRouting({
  locales,
  defaultLocale,
  // Arabic is the product. `/` serves Arabic with no prefix; English lives
  // under /en/*.
  localePrefix: 'as-needed',
  localeDetection: false,
  // No NEXT_LOCALE cookie. With detection off nothing reads it, and the
  // middleware was writing one on every visit from a browser set to English
  // — a cookie with no purpose is one more thing to disclose and to keep.
  localeCookie: false,
});
