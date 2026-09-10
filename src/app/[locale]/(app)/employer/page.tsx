import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  AlertTriangle,
  Clock,
  BadgeCheck,
  CreditCard,
  Eye,
  FileClock,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { EmptyDashboard, StatTile } from '@/components/dashboard/stat-tile';
import { SetupChecklist } from '@/components/employer/setup-checklist';
import { NextAction } from '@/components/dashboard/next-action';
import { TrendChart } from '@/components/dashboard/trend-chart';
import { ConversionBars } from '@/components/dashboard/conversion-bars';
import { requireEmployer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatNumber } from '@/lib/utils';
import type { EmployerSummary, EmployerTrend } from '@/lib/supabase/database.types';

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
 * The employer overview.
 *
 * Ordered by what needs attention rather than by what is biggest: new
 * applicants and listings about to expire come before totals, because those
 * are the two numbers that go stale if nobody looks.
 */
export default async function EmployerOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);

  const viewer = await requireEmployer(locale);
  const supabase = await createClient();

  // Two round trips that do not depend on each other, so they go together.
  const [{ data }, { data: trendData }] = await Promise.all([
    supabase.rpc('employer_summary'),
    supabase.rpc('employer_trend'),
  ]);
  const s = (data ?? null) as EmployerSummary | null;
  const trend = (trendData ?? null) as EmployerTrend | null;

  const t = await getTranslations('dashboard');
  const tCompanies = await getTranslations('companies');
  const tEmployer = await getTranslations('employer');
  const n = (value: number) => formatNumber(value, locale);

  if (!s || !s.has_company) {
    return (
      <div className="space-y-8">
        <header>
          <h1 className="text-2xl font-bold">{t('overview')}</h1>
        </header>
        <EmptyDashboard
          title={t('emptyEmployerTitle')}
          body={t('emptyEmployerBody')}
          action={
            <Button asChild>
              <Link href="/employer/company">{t('emptyEmployerCta')}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  // Only shown when there is something to compare against; a delta measured
  // from a week with no applicants is noise dressed as a trend.
  const delta =
    s.applicants_prev_7d > 0
      ? {
          value: `${n(Math.round(((s.applicants_7d - s.applicants_prev_7d) / s.applicants_prev_7d) * 100))}%`,
          direction:
            s.applicants_7d > s.applicants_prev_7d
              ? ('up' as const)
              : s.applicants_7d < s.applicants_prev_7d
                ? ('down' as const)
                : ('flat' as const),
        }
      : undefined;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">{t('overview')}</h1>
        <p className="mt-1 text-muted-foreground">{t('employerLede')}</p>
      </header>

      {/*
        One thing, chosen by an ordered list of conditions rather than by a
        model — first true wins, ties impossible, same state always the same
        card. Everything it reads was already fetched for the tiles below, so
        this costs no extra query.

        Order is by cost of ignoring it. Rejected paperwork blocks verification
        entirely; applicants nobody has opened are people waiting on a reply;
        an expiring listing disappears from search on a date; a draft is only
        work not yet done.
      */}
      {(() => {
        const action =
          s.verification === 'rejected'
            ? { kind: 'verification' as const, tone: 'urgent' as const, title: t('nextVerificationTitle'), body: t('nextVerificationBody'), cta: t('nextVerificationCta'), href: '/employer/company' }
            : s.applicants_unseen > 0
              ? { kind: 'applicants' as const, tone: 'good' as const, title: t('nextApplicantsTitle', { count: s.applicants_unseen }), body: t('nextApplicantsBody'), cta: t('nextApplicantsCta'), href: '/employer/applicants?stage=new' }
              : s.expiring_soon > 0
                ? { kind: 'expiring' as const, tone: 'attention' as const, title: t('nextExpiringTitle', { count: s.expiring_soon }), body: t('nextExpiringBody'), cta: t('nextExpiringCta'), href: '/employer/jobs' }
                : s.draft_jobs > 0
                  ? { kind: 'draft' as const, tone: 'attention' as const, title: t('nextDraftTitle'), body: t('nextDraftBody'), cta: t('nextDraftCta'), href: '/employer/jobs' }
                  : null;

        return action ? <NextAction {...action} /> : null;
      })()}

      {/*
        Before there is a listing, a scoreboard of zeroes is analytics
        pretending the product is in use. The checklist answers what an
        employer actually has on their first morning — what is done, what is
        left, what happens next — and the tiles below stand down until there is
        something for them to count.
      */}
      {s.live_jobs + s.pending_jobs === 0 ? (
        <SetupChecklist
          company={viewer.company}
          liveJobs={s.live_jobs}
          pendingJobs={s.pending_jobs}
          draftJobs={s.draft_jobs}
        />
      ) : null}

      {/* Said once, at the top, in the place the work is. A company whose
          account is still being reviewed will otherwise discover it by having
          the listing form refuse them, with no explanation of what to do about
          it — so this says what is happening and what moves it along. */}
      {viewer.profile.approval_status !== 'approved' ? (
        <div className="rounded-2xl border border-warning/40 bg-warning-muted p-5">
          <p className="flex items-center gap-2 font-semibold">
            <Clock className="size-4" aria-hidden />
            {tEmployer('pendingTitle')}
          </p>
          <p className="mt-2 text-sm leading-relaxed">{tEmployer('pendingBody')}</p>
          <Button asChild size="sm" variant="outline" className="mt-4">
            <Link href="/employer/company">{tEmployer('company')}</Link>
          </Button>
        </div>
      ) : null}

      {s.live_jobs + s.pending_jobs === 0 ? null : (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label={t('statApplicantsNew')}
          value={n(s.applicants_new)}
          // Was /employer/jobs — a list of listings, one click short of the
          // applicants the tile is counting.
          href="/employer/applicants?stage=new"
          icon={Users}
          tone={s.applicants_new > 0 ? 'accent' : 'default'}
        />
        <StatTile
          label={t('statApplicants7d')}
          value={n(s.applicants_7d)}
          href="/employer/applicants"
          icon={Send}
          hint={delta ? t('vsLastWeek') : undefined}
          delta={delta}
        />
        <StatTile
          label={t('statExpiring')}
          value={n(s.expiring_soon)}
          href="/employer/jobs"
          icon={AlertTriangle}
          tone={s.expiring_soon > 0 ? 'urgent' : 'default'}
        />
        <StatTile
          label={t('statLiveJobs')}
          value={n(s.live_jobs)}
          href="/employer/jobs"
          icon={BadgeCheck}
        />
        <StatTile
          label={t('statPending')}
          value={n(s.pending_jobs)}
          href="/employer/jobs"
          icon={FileClock}
          tone={s.pending_jobs > 0 ? 'warn' : 'default'}
        />
        <StatTile
          label={t('statViews')}
          value={n(s.total_views)}
          href="/employer/jobs"
          icon={Eye}
        />
        <StatTile
          label={t('statCredits')}
          value={n(s.credits)}
          href="/employer/billing"
          icon={CreditCard}
        />
        <StatTile
          label={t('statSeats')}
          value={n(s.seats_advertised)}
          href="/employer/jobs"
          icon={Users}
        />
        <StatTile
          label={t('statVerification')}
          value={s.verification === 'verified' ? tCompanies('verified') : tCompanies('unverified')}
          href="/employer/company"
          icon={ShieldCheck}
          tone={s.verification === 'verified' ? 'good' : 'warn'}
        />
      </div>
      )}

      {/* Below the tiles, not above them. The numbers are what needs acting on
          today; the shape of the month is context for them — and context for
          nothing is worse than nothing, so a company with no listing yet gets
          the checklist instead of a month of flat zero. */}
      {trend && trend.has_company && s.live_jobs + s.pending_jobs > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <TrendChart
            id="employer-applications"
            title={t('trendApplicationsTitle')}
            hint={t('trendApplicationsHint')}
            days={trend.days.map((day) => day.d)}
            series={[
              {
                key: 'applications',
                label: t('statApplicants'),
                tone: 'primary',
                values: trend.days.map((day) => day.applications),
              },
            ]}
            locale={locale}
            empty={t('trendEmpty')}
          />

          <ConversionBars rows={trend.conversion} locale={locale} />
        </div>
      ) : null}
    </div>
  );
}
