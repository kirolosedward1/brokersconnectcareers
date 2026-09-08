import { getTranslations } from 'next-intl/server';
import { ArrowRight, Building2, Clock, Eye, FileClock, Plus, TimerReset, Users } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { StatTile } from '@/components/dashboard/stat-tile';
import { formatNumber } from '@/lib/utils';

/**
 * The home page for somebody who hires.
 *
 * It used to be the candidate's home page with a strip added on top: a search
 * bar for jobs, then a feed of other companies' listings, then browse-by-track
 * and browse-by-district. The comment justifying that said the feed was "what
 * their listings are competing against", which was a rationalisation. Nobody
 * signs in to a hiring account to read competitors' adverts, and a page of
 * jobs to apply for is a strange thing to hand somebody who posts them.
 *
 * So this is their own operation instead: how many people are waiting to be
 * looked at, what is live, what is stuck in review, and what runs out this
 * week. Every tile is a link, because a number nobody can act on is
 * decoration.
 *
 * It is deliberately shorter than the console at /employer. The console is
 * where the work happens; this is the answer to "is there anything for me
 * today", and it should be readable without scrolling.
 */
export type EmployerSummary = {
  has_company: boolean;
  applicants_new: number;
  live_jobs: number;
  pending_jobs: number;
  expiring_soon: number;
  total_views: number;
};

export async function EmployerHome({
  locale,
  name,
  summary,
  approvalStatus,
}: {
  locale: Locale;
  name: string;
  summary: EmployerSummary | null;
  approvalStatus: string;
}) {
  const t = await getTranslations('home');
  const tDash = await getTranslations('dashboard');
  const tNav = await getTranslations('nav');
  const tEmployer = await getTranslations('employer');

  const n = (value: number) => formatNumber(value, locale);
  const hasCompany = Boolean(summary?.has_company);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('welcome', { name })}</h1>
          <p className="mt-1 text-muted-foreground">{tDash('employerLede')}</p>
        </div>

        <Button asChild variant="outline">
          <Link href="/employer">
            {tNav('employerArea')}
            <ArrowRight className="rtl-flip" aria-hidden />
          </Link>
        </Button>
      </header>

      {approvalStatus !== 'approved' ? (
        <div className="mt-8 rounded-2xl border border-warning/40 bg-warning-muted p-5">
          <p className="flex items-center gap-2 font-semibold">
            <Clock className="size-4" aria-hidden />
            {tEmployer('pendingTitle')}
          </p>
          <p className="mt-2 text-sm leading-relaxed">{tEmployer('pendingBody')}</p>
        </div>
      ) : null}

      {hasCompany && summary ? (
        <>
          <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile
              label={tDash('statApplicantsNew')}
              value={n(summary.applicants_new)}
              href="/employer/applicants?stage=new"
              icon={Users}
              tone={summary.applicants_new > 0 ? 'accent' : 'default'}
            />
            <StatTile
              label={tDash('statLiveJobs')}
              value={n(summary.live_jobs)}
              href="/employer/jobs"
              icon={Building2}
            />
            <StatTile
              label={tDash('statPending')}
              value={n(summary.pending_jobs)}
              href="/employer/jobs"
              icon={FileClock}
              tone={summary.pending_jobs > 0 ? 'warn' : 'default'}
            />
            <StatTile
              label={tDash('statExpiring')}
              value={n(summary.expiring_soon)}
              href="/employer/jobs"
              icon={TimerReset}
              tone={summary.expiring_soon > 0 ? 'urgent' : 'default'}
            />
            <StatTile
              label={tDash('statViews')}
              value={n(summary.total_views)}
              href="/employer/jobs"
              icon={Eye}
            />
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/employer/jobs/new">
                <Plus aria-hidden />
                {tEmployer('newJob')}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/employer/applicants">
                <Users aria-hidden />
                {tEmployer('allApplicants')}
              </Link>
            </Button>
          </div>
        </>
      ) : (
        /* No company row yet, so there is nothing to count. The one thing that
           unblocks everything else is the only thing offered. */
        <div className="mt-8 rounded-2xl border border-dashed border-border py-14 text-center">
          <p className="font-medium">{tDash('emptyEmployerTitle')}</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {tDash('emptyEmployerBody')}
          </p>
          <Button asChild className="mt-6">
            <Link href="/employer/company">
              <Building2 aria-hidden />
              {tDash('emptyEmployerCta')}
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
