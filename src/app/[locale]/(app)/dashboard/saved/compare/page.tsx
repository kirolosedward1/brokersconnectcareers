import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyIllustration } from '@/components/illustration';
import { CompareTable } from '@/components/dashboard/compare-table';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { requireCandidate } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { raise } from '@/lib/queries/error';
import { LIST_SELECT, type JobListItem } from '@/lib/queries/jobs';
import { jobIsLive } from '@/lib/job-state';
import { COMPARE_MIN, parseCompareIds } from '@/lib/saved/compare';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'compare' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * Saved listings side by side. The ids come from the saved page; this only
 * shows ones this person still has saved and that are still open, in the
 * order they were picked. Anything else is the empty state, not a column.
 */
export default async function CompareSavedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ids?: string | string[] }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const viewer = await requireCandidate(locale);
  const ids = parseCompareIds((await searchParams).ids);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('saved_jobs')
    .select(`job:jobs!inner (${LIST_SELECT})`)
    .eq('candidate_id', viewer.userId);

  if (error) raise(error, 'loading your saved jobs');

  const saved = new Map(
    ((data ?? []) as unknown as { job: JobListItem }[])
      .map((row) => row.job)
      .filter((job) => job && jobIsLive(job))
      .map((job) => [job.id, job]),
  );
  const jobs = ids.flatMap((id) => {
    const job = saved.get(id);
    return job ? [job] : [];
  });

  const t = await getTranslations('compare');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold">{t('title')}</h1>
      </header>

      {jobs.length < COMPARE_MIN ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <EmptyIllustration name="choose" />
          <p className="font-medium">{t('tooFew')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('tooFewBody')}</p>
          <Button asChild className="mt-5" variant="outline">
            <Link href="/dashboard/saved">{t('back')}</Link>
          </Button>
        </div>
      ) : (
        <>
          <CompareTable jobs={jobs} locale={locale} />
          <Button asChild variant="outline">
            <Link href="/dashboard/saved">{t('back')}</Link>
          </Button>
        </>
      )}
    </div>
  );
}
