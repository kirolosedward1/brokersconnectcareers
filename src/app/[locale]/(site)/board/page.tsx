import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { JobsBoard } from '@/components/jobs/jobs-board';
import { parseJobFilters, type SearchParams } from '@/lib/queries/jobs';

/**
 * A filtered, sorted or paged board.
 *
 * Reached by a rewrite of `/jobs?…`, so `/jobs` itself can be cached. Not a
 * URL of its own: middleware sends a direct request back to `/jobs`.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const tMeta = await getTranslations({ locale, namespace: 'meta' });
  await searchParams;

  return {
    title: { absolute: tMeta('jobsTitle') },
    description: tMeta('jobsDescription'),
    // A view, not a second copy of /jobs. No canonical beside the noindex.
    robots: { index: false, follow: true },
  };
}

export default async function FilteredJobsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const locale = asLocale((await params).locale);
  const filters = parseJobFilters(await searchParams);
  return <JobsBoard locale={locale} filters={filters} />;
}
