import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, alternatesFor } from '@/i18n/routing';
import { Landing } from '@/components/home/landing';
import { getDistricts } from '@/lib/queries/taxonomy';
import { anonymousJobs, EMPTY_FILTERS, queryJobs } from '@/lib/queries/jobs';
import { optional } from '@/lib/queries/error';
import { getBrowseCounts } from '@/lib/queries/browse';
import { withOpenings } from '@/lib/seo/meta-text';
import { openingsLead } from '@/lib/seo/openings';

/**
 * The public landing. A signed-in reader is rewritten to /signed-home before
 * this renders, so the cached HTML is only the pitch — never a person's feed.
 */
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'meta' });
  const lead = await openingsLead(locale);
  return {
    title: { absolute: t('homeTitle') },
    description: withOpenings(lead, t('homeDescription'), t('descriptionPad')),
    alternates: alternatesFor('/', locale),
  };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);

  const districts = await optional(getDistricts(), []);
  const [counts, latest] = await Promise.all([
    optional(getBrowseCounts(), null),
    optional(queryJobs({ ...EMPTY_FILTERS }, anonymousJobs()), { jobs: [], total: 0, pageCount: 0, page: 1 }),
  ]);

  return <Landing locale={locale} districts={districts} counts={counts} jobs={latest.jobs} />;
}
