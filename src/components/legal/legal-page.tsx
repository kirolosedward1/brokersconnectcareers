import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { alternatesFor, asLocale, type Locale } from '@/i18n/routing';
import { LegalDocument } from '@/components/legal-document';
import { getLegalDoc, type LegalSlug } from '@/lib/legal';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * The language a legal document is read in: the site's, unless `?lang=` asks
 * for the other one.
 *
 * English is switched off for the site (ENGLISH_ENABLED), and `/en/terms`
 * redirects to Arabic — but the people these documents bind include a company
 * whose staff read English, App Review, and the operator in Dubai, and a
 * document they cannot read is one they did not agree to. So every legal page
 * serves its English text at `?lang=en`, whatever the site's languages are.
 */
function documentLanguage(locale: Locale, lang: string | string[] | undefined): Locale {
  return lang === 'en' || lang === 'ar' ? lang : locale;
}

/**
 * One legal page: `/<slug>`, its document from content/legal, and a link to
 * the same document in the other language. Each page file is these two
 * exports and nothing else, so the five pages cannot drift apart.
 */
export function legalPage(slug: LegalSlug) {
  const path = `/${slug}`;

  async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
    const locale = asLocale((await params).locale);
    const lang = documentLanguage(locale, (await searchParams).lang);
    const doc = getLegalDoc(slug, lang);
    const alternates = alternatesFor(path, locale);
    return {
      title: doc?.title,
      // Indexable, unlike the placeholders that stood here. A real privacy
      // policy is a trust signal search engines look for from a business
      // handling CVs.
      robots: { index: true, follow: true },
      alternates: doc && doc.lang !== locale ? { canonical: `${alternates.canonical}?lang=${doc.lang}` } : alternates,
    };
  }

  async function LegalPage({ params, searchParams }: Props) {
    const locale = asLocale((await params).locale);
    setRequestLocale(locale);
    const doc = getLegalDoc(slug, documentLanguage(locale, (await searchParams).lang));

    // Offered only when the other file exists: getLegalDoc falls back to the
    // language it has, and a link to the same text would be a link to nowhere.
    const otherLang: Locale = doc?.lang === 'ar' ? 'en' : 'ar';
    const hasOther = getLegalDoc(slug, otherLang)?.lang === otherLang;
    const tOther = await getTranslations({ locale: otherLang, namespace: 'legal' });

    return (
      <LegalDocument
        doc={doc}
        locale={locale}
        other={
          doc && hasOther
            ? {
                href: otherLang === locale ? { pathname: path } : { pathname: path, query: { lang: otherLang } },
                lang: otherLang,
                label: tOther('readThisIn'),
              }
            : null
        }
      />
    );
  }

  return { generateMetadata, LegalPage };
}
