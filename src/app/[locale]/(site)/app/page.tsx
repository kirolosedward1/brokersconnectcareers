import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, alternatesFor } from '@/i18n/routing';
import { GetAppLanding } from '@/components/get-app/get-app-landing';
import { BreadcrumbJsonLd } from '@/components/seo/breadcrumb-jsonld';
import { SITE_NAME } from '@/lib/seo/site-jsonld';

/**
 * The social card is this page's own, not the site's: a link to "get the
 * app" shared on WhatsApp should show a phone, not the board's tagline. Drawn
 * by scripts/og-app-card.mjs from the hero's own words, so a change to the
 * headline is a change to the card.
 *
 * Restated in full rather than only adding the image: Next replaces a parent's
 * `openGraph` with the page's rather than merging the two, so the site name
 * and the locale would otherwise go missing from this one page.
 */
const OG_IMAGE = '/brand/og-app.jpg';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'appPage' });

  const title = t('meta.title');
  const description = t('meta.description');

  return {
    title,
    description,
    alternates: alternatesFor('/app', locale),
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: locale === 'ar' ? 'ar_EG' : 'en_US',
      title,
      description,
      images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: t('meta.ogAlt') }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [OG_IMAGE],
    },
  };
}

/**
 * /app — the page that sends a visitor to the app stores.
 *
 * Its own route, not a section of the home page: it is the link the app's
 * store listing, a WhatsApp message and a QR code all point at, and "download
 * the Brokers Connect app" is a search of its own.
 */
export default async function GetAppPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);

  const t = await getTranslations('appPage');
  const tMeta = await getTranslations('meta');
  return (
    <>
      <BreadcrumbJsonLd
        locale={locale}
        crumbs={[{ name: tMeta('siteName'), path: '/' }, { name: t('hero.title') }]}
      />
      <GetAppLanding />
    </>
  );
}
