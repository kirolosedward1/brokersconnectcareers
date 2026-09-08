import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale, type Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { JobCard } from '@/components/jobs/job-card';
import { SavedSearchList } from '@/components/dashboard/saved-search-list';
import { requireCandidate } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { JobListItem } from '@/lib/queries/jobs';
import type { SavedSearchRow } from '@/lib/supabase/database.types';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return { title: t('saved'), robots: { index: false, follow: false } };
}

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

  const { data: searchRows } = await supabase
    .from('saved_searches')
    .select('*')
    .order('created_at', { ascending: false });

  // Which of these were applied to. This is a list somebody curated by hand,
  // so "did I already apply to that one" is the question they arrive with —
  // and it was answerable only by opening each listing.
  const { data: mine } = await supabase.from('applications').select('job_id');
  const appliedTo = new Set((mine ?? []).map((row) => row.job_id));

  const t = await getTranslations('dashboard');
  const tJobs = await getTranslations('jobs');
  const tSearch = await getTranslations('savedSearch');

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-bold">{t('saved')}</h1>
        <p className="mt-1 text-muted-foreground">{t('savedLede')}</p>
      </header>

      {/* The saved listings first, and with no heading of its own: the page
          is already called "saved jobs", and a section repeating the h1 word
          for word told a reader nothing they had not just read. Saved searches
          are the secondary thing here, so they follow. */}
      <section aria-labelledby="saved-jobs-heading">
        <h2 id="saved-jobs-heading" className="sr-only">
          {t('saved')}
        </h2>

        {jobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-16 text-center">
            <p className="font-medium">{t('emptySaved')}</p>
            <Button asChild className="mt-5">
              <Link href="/jobs">{tJobs('title')}</Link>
            </Button>
          </div>
        ) : (
          <ul className="space-y-3">
            {jobs.map((job) => (
              <li key={job.id}>
                {/* `saved` is not passed: every card here is saved, so the
                    badge would be on all of them and mean nothing. */}
                <JobCard job={job} locale={locale} applied={appliedTo.has(job.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 font-semibold">{tSearch('title')}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{tSearch('weekly')}</p>
        <SavedSearchList searches={(searchRows ?? []) as SavedSearchRow[]} />
      </section>
    </div>
  );
}
