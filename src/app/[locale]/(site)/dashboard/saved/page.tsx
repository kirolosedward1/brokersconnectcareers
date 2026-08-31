import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale, type Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { JobCard } from '@/components/jobs/job-card';
import { requireCandidate } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { JobListItem } from '@/lib/queries/jobs';

export default async function SavedJobsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  await requireCandidate(locale);

  const supabase = await createClient();
  const { data } = await supabase
    .from('saved_jobs')
    .select(
      `
      created_at,
      job:jobs!inner (
        *,
        company:companies!inner (id, name_ar, name_en, slug, logo_url, verification_status),
        district:districts!inner (id, governorate_id, name_ar, name_en, slug)
      )
    `,
    )
    .order('created_at', { ascending: false });

  const jobs = ((data ?? []) as unknown as { job: JobListItem }[])
    .map((row) => row.job)
    .filter(Boolean);

  const t = await getTranslations('dashboard');
  const tJobs = await getTranslations('jobs');

  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <p className="font-medium">{t('emptySaved')}</p>
        <Button asChild className="mt-5">
          <Link href="/jobs">{tJobs('title')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {jobs.map((job) => (
        <li key={job.id}>
          <JobCard job={job} locale={locale} />
        </li>
      ))}
    </ul>
  );
}
