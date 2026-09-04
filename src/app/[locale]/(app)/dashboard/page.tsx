import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Bell, BookmarkCheck, Briefcase, MessageSquare, Search, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { EmptyDashboard, StatTile } from '@/components/dashboard/stat-tile';
import { requireCandidate } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatNumber } from '@/lib/utils';
import type { CandidateSummary } from '@/lib/supabase/database.types';

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

  const { data } = await supabase.rpc('candidate_summary');
  const s = (data ?? null) as CandidateSummary | null;

  const t = await getTranslations('dashboard');
  const tJobs = await getTranslations('jobs');
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
    </div>
  );
}
