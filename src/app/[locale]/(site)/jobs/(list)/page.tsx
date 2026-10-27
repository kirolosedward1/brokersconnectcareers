import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, alternatesFor } from '@/i18n/routing';
import { JobsBoard } from '@/components/jobs/jobs-board';
import { BreadcrumbJsonLd } from '@/components/seo/breadcrumb-jsonld';
import { EMPTY_FILTERS } from '@/lib/queries/jobs';
import { withOpenings } from '@/lib/seo/meta-text';
import { openingsLead } from '@/lib/seo/openings';

/** The unfiltered board. Filtered views are rewritten to /board. */
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
    title: { absolute: t('jobsTitle') },
    description: withOpenings(lead, t('jobsDescription'), t('descriptionPad')),
    alternates: alternatesFor('/jobs', locale),
  };
}

export default async function JobsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const tMeta = await getTranslations('meta');
  const tJobs = await getTranslations('jobs');
  return (
    <>
      <BreadcrumbJsonLd
        locale={locale}
        crumbs={[{ name: tMeta('siteName'), path: '/' }, { name: tJobs('title') }]}
      />
      <JobsBoard locale={locale} filters={EMPTY_FILTERS} />
    </>
  );
}
