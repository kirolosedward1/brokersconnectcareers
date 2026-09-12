import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale, type Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { JobCard } from '@/components/jobs/job-card';
import { SavedSearchList } from '@/components/dashboard/saved-search-list';
import { requireCandidate } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { raise } from '@/lib/queries/error';
import type { JobListItem } from '@/lib/queries/jobs';
import type { SavedSearchRow } from '@/lib/supabase/database.types';
import { jobIsLive } from '@/lib/job-state';

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
  const viewer = await requireCandidate(locale);

  const supabase = await createClient();
  /*
    The error is read, not dropped. A bookmark list that renders empty on a
    failed read teaches somebody that saving is unreliable, which is the one
    thing a bookmark cannot afford to be.
  */
  const { data, error } = await supabase
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
    /*
      Scoped explicitly, with row-level security still behind it.

      Not a second copy of the policy: RLS decides what may be seen, this
      decides what to look at — which is the difference between an index scan
      and a sequential one whose filter runs a function per row. A wrong filter
      here can only show fewer rows, never more.
    */
    .eq('candidate_id', viewer.userId)
    .order('created_at', { ascending: false });

  if (error) raise(error, 'loading your saved jobs');

  const jobs = ((data ?? []) as unknown as { job: JobListItem }[])
    .map((row) => row.job)
    .filter(Boolean);

  /**
   * A saved role that has ended is not the same object as one still hiring.
   *
   * The list was one stack in the order things were bookmarked, so a listing
   * that expired three weeks ago sat above two that are open — and the only
   * way to find that out was to open it. The card marks a closed role, but the
   * order still put dead ones in the way of live ones.
   *
   * They are not deleted. A bookmark is the reader's own list, and a product
   * that quietly removes rows from it teaches people that saving is
   * unreliable; the closed ones move below a heading that says why, and the
   * bookmark on each card is how they leave.
   */
  // Through jobIsLive(), not a second copy of it. This was the same
  // expression written out again, and a rule in three places is a rule that
  // will eventually be three rules.
  const open = jobs.filter((job) => jobIsLive(job));
  const closed = jobs.filter((job) => !jobIsLive(job));

  const { data: searchRows, error: searchError } = await supabase
    .from('saved_searches')
    .select('*')
    .eq('candidate_id', viewer.userId)
    .order('created_at', { ascending: false });

  // Same reason: an empty list here reads as "you follow nobody and saved
  // nothing", and the weekly mail would keep arriving to contradict it.
  if (searchError) raise(searchError, 'loading your saved searches and follows');

  // Which of these were applied to. This is a list somebody curated by hand,
  // so "did I already apply to that one" is the question they arrive with —
  // and it was answerable only by opening each listing.
  // Allowed to fail quietly: this only decides whether a card carries an
  // "applied" badge. Losing it understates, and the listing itself says so
  // when they open it.
  const { data: mine } = await supabase
    .from('applications')
    .select('job_id')
    .eq('candidate_id', viewer.userId);
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
          <div className="space-y-8">
            {open.length > 0 ? (
              <div>
                {/* The heading only earns its place once there is a second
                    group to tell this one apart from. */}
                {closed.length > 0 ? (
                  <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                    {t('savedOpenHeading')}
                  </h3>
                ) : null}
                <ul className="space-y-3">
                  {open.map((job) => (
                    <li key={job.id}>
                      <JobCard
                        job={job}
                        locale={locale}
                        applied={appliedTo.has(job.id)}
                        saved
                        savable
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {closed.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground">
                  {t('savedClosedHeading')}
                </h3>
                <p className="mb-3 mt-0.5 text-sm text-muted-foreground">
                  {t('savedClosedLede')}
                </p>
                <ul className="space-y-3">
                  {closed.map((job) => (
                    <li key={job.id}>
                      <JobCard
                        job={job}
                        locale={locale}
                        applied={appliedTo.has(job.id)}
                        saved
                        savable
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
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
