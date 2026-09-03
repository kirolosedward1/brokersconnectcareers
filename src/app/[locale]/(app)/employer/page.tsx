import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  AlertTriangle,
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
import { requireEmployer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatNumber } from '@/lib/utils';
import type { EmployerSummary } from '@/lib/supabase/database.types';

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

  await requireEmployer(locale);
  const supabase = await createClient();

  const { data } = await supabase.rpc('employer_summary');
  const s = (data ?? null) as EmployerSummary | null;

  const t = await getTranslations('dashboard');
  const tCompanies = await getTranslations('companies');
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label={t('statApplicantsNew')}
          value={n(s.applicants_new)}
          href="/employer/jobs"
          icon={Users}
          tone={s.applicants_new > 0 ? 'accent' : 'default'}
        />
        <StatTile
          label={t('statApplicants7d')}
          value={n(s.applicants_7d)}
          href="/employer/jobs"
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
    </div>
  );
}
