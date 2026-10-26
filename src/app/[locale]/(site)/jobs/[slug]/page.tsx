import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, alternatesFor, localized } from '@/i18n/routing';
import { TrackDistrictLanding } from '@/components/jobs/track-district-landing';
import { anonymousJobs, EMPTY_FILTERS, queryJobs } from '@/lib/queries/jobs';
import { fitDescription, fitTitle, titleRoom } from '@/lib/seo/meta-text';
import { parseLandingSlug } from '@/lib/taxonomy';
import { getDistrictBySlug } from '@/lib/queries/taxonomy';
import type { DistrictRow, JobTrack } from '@/lib/supabase/database.types';

type Params = { locale: string; slug: string };

/**
 * Track-in-district landings only.
 *
 * A listing is rewritten to `/listing/<slug>` before it reaches here, because
 * that page reads the session. This one never calls cookies(), so it can be
 * cached. Nothing is built ahead of time: an empty cross-product is noindex,
 * and the pairs that have listings are filled on the first request.
 */
export const revalidate = 300;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Landing = { track: JobTrack; district: DistrictRow };

async function landingFor(slug: string): Promise<Landing | null> {
  const parsed = parseLandingSlug(slug);
  if (!parsed) return null;
  const district = await getDistrictBySlug(parsed.districtSlug);
  if (!district) return null;
  return { track: parsed.track, district };
}

/**
 * The listing page, loaded only when this slug is not a landing.
 *
 * A dynamic import keeps `cookies()` out of the landing render, so a
 * track-in-district page can stay cached. When the middleware rewrite did
 * not run, a real job slug would otherwise 404 here.
 */
function listingPage() {
  return import('../../listing/[slug]/page');
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  const landing = await landingFor(slug);
  if (!landing) {
    const listing = await listingPage();
    return listing.generateMetadata({ params });
  }

  const t = await getTranslations({ locale, namespace: 'landing' });
  const tTrack = await getTranslations({ locale, namespace: 'track' });
  const track = tTrack(landing.track);
  const district = localized(locale, landing.district.name_ar, landing.district.name_en);

  const { total } = await queryJobs(
    {
      ...EMPTY_FILTERS,
      tracks: [landing.track],
      districtSlugs: [landing.district.slug],
    },
    anonymousJobs(),
  );

  const tMeta = await getTranslations({ locale, namespace: 'meta' });
  const metaTitle = fitTitle(t('metaTitle', { track, district }), titleRoom(tMeta('siteName')));

  return {
    title: metaTitle,
    description: fitDescription(t('subtitle', { track, district }), tMeta('descriptionPad')),
    ...(total === 0
      ? { robots: { index: false, follow: true } }
      : { alternates: alternatesFor(`/jobs/${slug}`, locale) }),
  };
}

export default async function LandingPage({ params }: { params: Promise<Params> }) {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const landing = await landingFor(slug);
  if (!landing) {
    const listing = await listingPage();
    return listing.default({ params });
  }

  return (
    <TrackDistrictLanding track={landing.track} district={landing.district} locale={locale} />
  );
}
