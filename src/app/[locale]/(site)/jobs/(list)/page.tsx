import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, alternatesFor } from '@/i18n/routing';
import { JobsBoard } from '@/components/jobs/jobs-board';
import { EMPTY_FILTERS } from '@/lib/queries/jobs';

/** The unfiltered board. Filtered views are rewritten to /board. */
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'meta' });
  return {
    title: { absolute: t('jobsTitle') },
    description: t('jobsDescription'),
    alternates: alternatesFor('/jobs', locale),
  };
}

export default async function JobsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  return <JobsBoard locale={locale} filters={EMPTY_FILTERS} />;
}
