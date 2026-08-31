import { defineRouting } from 'next-intl/routing';

export const locales = ['ar', 'en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'ar';

/**
 * English is built and translated but not published yet.
 *
 * Flipping this to `true` restores the whole English side: the locale switcher
 * reappears, /en stops redirecting, hreflang pairs come back, and the sitemap
 * emits both languages. Nothing about the English copy was removed — only its
 * routes are closed.
 */
export const ENGLISH_ENABLED = false;

/** The locales actually served right now. */
export const activeLocales: readonly Locale[] = ENGLISH_ENABLED ? locales : ['ar'];

export const routing = defineRouting({
  locales,
  defaultLocale,
  // Arabic is the product. `/` serves Arabic with no prefix; English lives
  // under /en/*.
  localePrefix: 'as-needed',
  localeDetection: false,
});

export function dirOf(locale: string): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Canonical URL and hreflang for one path, in one place — so closing the
 * English side does not mean hunting through every generateMetadata.
 */
export function alternatesFor(path: string, locale: string) {
  if (!ENGLISH_ENABLED) {
    // One published language means one canonical and no alternates: an
    // hreflang pointing at a redirect is worse than none at all.
    return { canonical: path };
  }

  return {
    canonical: locale === defaultLocale ? path : `/${locale}${path}`,
    languages: { ar: path, en: `/en${path}`, 'x-default': path } as Record<string, string>,
  };
}

/**
 * Arabic is required on every content table, English is optional. Fall back to
 * Arabic whenever the English column is null — never show an empty field.
 */
export function localized(
  locale: string,
  ar: string | null | undefined,
  en: string | null | undefined,
): string {
  if (locale === 'en') return (en?.trim() || ar?.trim()) ?? '';
  return (ar?.trim() || en?.trim()) ?? '';
}
