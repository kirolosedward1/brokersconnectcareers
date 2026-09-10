import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Bell, BookmarkCheck, Briefcase, MessageSquare, Search, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyDashboard, StatTile } from '@/components/dashboard/stat-tile';
import { NextAction } from '@/components/dashboard/next-action';
import { JobCard } from '@/components/jobs/job-card';
import { requireCandidate } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { EMPTY_FILTERS, queryJobs } from '@/lib/queries/jobs';
import { optional } from '@/lib/queries/error';
import { getDistricts } from '@/lib/queries/taxonomy';
import { rankJobs } from '@/lib/match';
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
  const [{ data }, { data: recent }, { data: mine }, openRoles, { data: agent }, districts] =
    await Promise.all([
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
    /*
      Every live role, ordered below rather than filtered here.

      Filtering to this candidate's own tracks mostly produces an empty block on
      a board this size, and "nothing for you" is a worse answer than "here is
      what is open". Ranking has neither problem: the same listings appear, best
      fit first, so the objection to filtering does not apply to ordering.
    */
    optional(queryJobs({ ...EMPTY_FILTERS }), { jobs: [], total: 0, pageCount: 0 }),
    /*
      What the ranking is against — the consultant's own stated track,
      districts and years. Nothing inferred.

      Filtered by user_id explicitly, unlike the applications read above, which
      genuinely can lean on row-level security. This table has four read
      policies and one of them is `visibility = 'public'`, so a signed-in
      consultant sees their own row *and* every public profile in the
      directory. Left to RLS, maybeSingle() matched many rows, errored, and
      handed back null — which silently produced the unpersonalised ordering
      for somebody whose profile was complete.
    */
    supabase
      .from('agent_profiles')
      .select('tracks, district_ids, years_experience')
      .eq('user_id', viewer.profile.id)
      .maybeSingle(),
    optional(getDistricts(), []),
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
  const unapplied = openRoles.jobs.filter((job) => !appliedTo.has(job.id));

  /*
    Their own board first, and only where that means something.

    `personalised` is false when the profile names no track and no district, in
    which case every score is zero and the newest-first order is untouched —
    the same list this page showed before. Saying so, and offering the fix, is
    better than reordering nothing and calling it a recommendation.
  */
  const { ranked, personalised } = rankJobs(unapplied, {
    tracks: agent?.tracks ?? null,
    districtIds: agent?.district_ids ?? null,
    yearsExperience: agent?.years_experience ?? null,
  });
  const suggestions = ranked.slice(0, 3);
  const districtName = new Map(
    districts.map((d) => [d.id, localized(locale, d.name_ar, d.name_en)]),
  );

  const t = await getTranslations('dashboard');
  const tJobs = await getTranslations('jobs');
  const tStatus = await getTranslations('applicationStatus');
  const tTrack = await getTranslations('track');
  const n = (value: number) => formatNumber(value, locale);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">
          {t('candidateGreeting', { name: viewer.profile.full_name })}
        </h1>
        <p className="mt-1 text-muted-foreground">{t('candidateLede')}</p>
      </header>

      {/*
        The candidate's one next action, same rule as the employer's: an
        ordered list, first true wins. A reply is somebody else moving; an
        incomplete profile is the thing that decides whether a verified company
        can find them at all. Below 60% matches the threshold the completeness
        tile already warns at, so the page does not disagree with itself.
      */}
      {(() => {
        if (!s) return null;
        const action =
          s.replies > 0
            ? { kind: 'replies' as const, tone: 'good' as const, title: t('nextRepliesTitle', { count: s.replies }), body: t('nextRepliesBody'), cta: t('nextRepliesCta'), href: '/dashboard/applications' }
            : s.profile_completeness < 60
              ? { kind: 'profile' as const, tone: 'attention' as const, title: t('nextProfileTitle'), body: t('nextProfileBody'), cta: t('nextProfileCta'), href: '/dashboard/profile' }
              : null;

        return action ? <NextAction {...action} /> : null;
      })()}

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
              {personalised ? t('matchedRoles') : t('openRoles')}
            </h2>
            <Link href="/jobs" className="text-sm font-medium text-primary hover:underline">
              {t('seeAll')}
            </Link>
          </div>

          {/* The order means nothing without a profile behind it, so rather
              than dress up newest-first as a recommendation, say what is
              missing and link to the one screen that fixes it. */}
          {personalised ? null : (
            <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              {t('matchNudge')}{' '}
              <Link href="/dashboard/profile" className="font-medium text-primary hover:underline">
                {t('matchNudgeCta')}
              </Link>
            </p>
          )}

          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {suggestions.map(({ job, score, reasons }) => (
              <li key={job.id} className="flex flex-col gap-1.5">
                <JobCard job={job} locale={locale} />

                {/* Why this one, in the consultant's own words — the track and
                    district they typed into their profile, not a score. A
                    reader who cannot check a recommendation is entitled to
                    distrust it. */}
                {score > 0 ? (
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{t('matchWhy')}</span>
                    {reasons.track ? <span>{tTrack(reasons.track)}</span> : null}
                    {reasons.districtId ? (
                      <span>{districtName.get(reasons.districtId)}</span>
                    ) : null}
                    {reasons.experience ? <span>{t('matchExperience')}</span> : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
