import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Bell, BookmarkCheck, Briefcase, MessageSquare, Search, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyDashboard, StatTile } from '@/components/dashboard/stat-tile';
import { JobCard } from '@/components/jobs/job-card';
import { requireCandidate } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { EMPTY_FILTERS, queryJobs } from '@/lib/queries/jobs';
import { optional } from '@/lib/queries/error';
import { formatDate, formatNumber } from '@/lib/utils';
import type { ApplicationStatus, CandidateSummary } from '@/lib/supabase/database.types';

/** Shared with the applications page, which shows the same states in full. */
const STATUS_VARIANT: Record<ApplicationStatus, 'default' | 'primary' | 'success' | 'destructive'> =
  {
    new: 'default',
    shortlisted: 'primary',
    interview: 'primary',
    hired: 'success',
    rejected: 'destructive',
  };

type RecentApplication = {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  decision_note: string | null;
  job: {
    slug: string;
    title_ar: string;
    title_en: string | null;
    company: { name_ar: string; name_en: string | null } | null;
  } | null;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return { title: t('overview'), robots: { index: false, follow: false } };
}

/**
 * The candidate overview.
 *
 * Was a redirect to the applications tab. Now the summary comes first and the
 * tabs are where you go from it — every tile links to the page that can act on
 * the number it shows.
 */
export default async function DashboardOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);

  const viewer = await requireCandidate(locale);
  const supabase = await createClient();

  /**
   * The numbers, and then the two things the numbers are about.
   *
   * This page was six tiles and stop. A candidate opens it to learn whether
   * anything happened and what to do next, and a scoreboard answers neither —
   * every figure was a link to somewhere else, which is a page that exists to
   * be left.
   */
  const [{ data }, { data: recent }, { data: mine }, openRoles] = await Promise.all([
    supabase.rpc('candidate_summary'),
    supabase
      .from('applications')
      .select(
        `
        id, status, created_at, decision_note,
        job:jobs (slug, title_ar, title_en, company:companies (name_ar, name_en))
      `,
      )
      .order('created_at', { ascending: false })
      .limit(3),
    // Every job this candidate has applied to, ids only, to keep them out of
    // the suggestions below. Scoped by row-level security, so no candidate_id
    // filter is written here.
    supabase.from('applications').select('job_id'),
    // Newest live roles, sliced below. Not filtered to this candidate's own
    // tracks: on a board this size a filter mostly produces an empty block,
    // and "nothing for you" is a worse answer than "here is what is open".
    optional(queryJobs({ ...EMPTY_FILTERS }), { jobs: [], total: 0, pageCount: 0 }),
  ]);

  const s = (data ?? null) as CandidateSummary | null;
  const applications = (recent ?? []) as unknown as RecentApplication[];
  /**
   * Roles worth a look — which excludes the ones already applied to.
   *
   * The applications sit directly above this block, so suggesting a job that
   * appears in both is not a suggestion, it is a rendering mistake somebody
   * has to reason about.
   */
  const appliedTo = new Set((mine ?? []).map((row) => row.job_id));
  const suggestions = openRoles.jobs.filter((job) => !appliedTo.has(job.id)).slice(0, 3);

  const t = await getTranslations('dashboard');
  const tJobs = await getTranslations('jobs');
  const tStatus = await getTranslations('applicationStatus');
  const n = (value: number) => formatNumber(value, locale);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">
          {t('candidateGreeting', { name: viewer.profile.full_name })}
        </h1>
        <p className="mt-1 text-muted-foreground">{t('candidateLede')}</p>
      </header>

      {!s || s.applications_total === 0 ? (
        <EmptyDashboard
          title={t('emptyCandidateTitle')}
          body={t('emptyCandidateBody')}
          action={
            <Button asChild>
              <Link href="/jobs">{tJobs('title')}</Link>
            </Button>
          }
        />
      ) : null}

      {s ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile
            label={t('statApplications')}
            value={n(s.applications_total)}
            href="/dashboard/applications"
            icon={Briefcase}
            tone="accent"
          />
          <StatTile
            label={t('statReplies')}
            value={n(s.replies)}
            href="/dashboard/applications"
            icon={MessageSquare}
            tone={s.replies > 0 ? 'good' : 'default'}
          />
          <StatTile
            label={t('statCompleteness')}
            value={`${n(s.profile_completeness)}%`}
            href="/dashboard/profile"
            icon={UserRound}
            tone={s.profile_completeness < 60 ? 'warn' : 'default'}
          />
          <StatTile
            label={t('statSaved')}
            value={n(s.saved_jobs)}
            href="/dashboard/saved"
            icon={BookmarkCheck}
          />
          <StatTile
            label={t('statAlerts')}
            value={n(s.alerts_on)}
            href="/dashboard/saved"
            icon={Bell}
          />
          <StatTile
            label={t('statOpenJobs')}
            value={n(s.open_jobs)}
            href="/jobs"
            icon={Search}
          />
        </div>
      ) : null}

      {/* Where your applications actually stand.
          "Did anybody reply" is the question this page is opened with, and
          it was answered by a tile reading a number and a link elsewhere. */}
      {applications.length ? (
        <section className="space-y-3" aria-labelledby="recent-applications">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="recent-applications" className="text-lg font-semibold">
              {t('applications')}
            </h2>
            <Link
              href="/dashboard/applications"
              className="text-sm font-medium text-primary hover:underline"
            >
              {t('seeAll')}
            </Link>
          </div>

          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {applications.map((application) => (
              <li key={application.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {application.job
                      ? localized(locale, application.job.title_ar, application.job.title_en)
                      : '—'}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {application.job?.company
                      ? localized(
                          locale,
                          application.job.company.name_ar,
                          application.job.company.name_en,
                        )
                      : ''}
                    <span aria-hidden> · </span>
                    {formatDate(application.created_at, locale)}
                  </p>
                </div>

                <Badge variant={STATUS_VARIANT[application.status]} size="lg">
                  {tStatus(application.status)}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* And what to do next, which is the other half of why somebody opens
          a dashboard. Newest rather than matched — see the query. */}
      {suggestions.length ? (
        <section className="space-y-3" aria-labelledby="open-roles">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="open-roles" className="text-lg font-semibold">
              {t('openRoles')}
            </h2>
            <Link href="/jobs" className="text-sm font-medium text-primary hover:underline">
              {t('seeAll')}
            </Link>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {suggestions.map((job) => (
              <li key={job.id}>
                <JobCard job={job} locale={locale} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
