import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  Building2,
  Clock,
  FileCheck2,
  Flag,
  Send,
  ShieldAlert,
  UserPlus,
  Users,
} from 'lucide-react';
import { asLocale } from '@/i18n/routing';
import { StatTile } from '@/components/dashboard/stat-tile';
import { TrendChart } from '@/components/dashboard/trend-chart';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatNumber } from '@/lib/utils';
import type { AdminSummary, AdminTrend } from '@/lib/supabase/database.types';

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
 * The moderation overview.
 *
 * Queue depth by age leads. A queue total on its own hides a backlog that is
 * not moving — twelve waiting is fine if they arrived this morning and a
 * problem if they have been there two days.
 */
export default async function AdminOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);

  await requireAdmin(locale);
  const supabase = await createClient();

  const [{ data }, { data: trendData }] = await Promise.all([
    supabase.rpc('admin_summary'),
    supabase.rpc('admin_trend'),
  ]);
  const s = (data ?? null) as AdminSummary | null;
  const trend = (trendData ?? null) as AdminTrend | null;

  const t = await getTranslations('dashboard');
  const n = (value: number) => formatNumber(value, locale);

  if (!s) return null;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">{t('overview')}</h1>
        <p className="mt-1 text-muted-foreground">{t('adminLede')}</p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label={t('statQueue')}
          value={n(s.queue_total)}
          href="/admin/jobs"
          icon={FileCheck2}
          tone={s.queue_total > 0 ? 'accent' : 'default'}
        />
        <StatTile
          label={t('statQueueOld')}
          value={n(s.queue_over_24h)}
          href="/admin/jobs"
          icon={Clock}
          tone={s.queue_over_24h > 0 ? 'urgent' : 'default'}
        />
        <StatTile
          label={t('statReports')}
          value={n(s.reports_open)}
          href="/admin/reports"
          icon={Flag}
          tone={s.reports_open > 0 ? 'warn' : 'default'}
        />
        <StatTile
          label={t('statCompaniesPending')}
          value={n(s.companies_pending)}
          href="/admin/companies"
          icon={ShieldAlert}
          tone={s.companies_pending > 0 ? 'warn' : 'default'}
        />

        <StatTile label={t('statLiveJobs')} value={n(s.live_jobs)} href="/jobs" icon={Send} />
        <StatTile
          label={t('statPublished')}
          value={n(s.published_7d)}
          href="/admin/jobs"
          icon={FileCheck2}
        />
        <StatTile label={t('statSignups')} value={n(s.signups_7d)} href="/admin" icon={UserPlus} />
        <StatTile
          label={t('statApplications')}
          value={n(s.applications_7d)}
          href="/admin"
          icon={Users}
        />

        <StatTile
          label={t('statCompanies')}
          value={n(s.companies_total)}
          href="/admin/companies"
          icon={Building2}
        />
      </div>

      {/* One axis, three series. Whether the two sides of the marketplace are
          growing at the same rate is the question here, and it is invisible
          when each number sits on its own tile. */}
      {trend ? (
        <TrendChart
          id="admin-activity"
          title={t('trendActivityTitle')}
          hint={t('trendActivityHint')}
          days={trend.days.map((day) => day.d)}
          series={[
            {
              key: 'applications',
              label: t('statApplications'),
              tone: 'primary',
              values: trend.days.map((day) => day.applications),
            },
            {
              key: 'published',
              label: t('trendPublished'),
              tone: 'success',
              values: trend.days.map((day) => day.published),
            },
            {
              key: 'signups',
              label: t('trendSignups'),
              tone: 'warning',
              values: trend.days.map((day) => day.signups),
            },
          ]}
          locale={locale}
          empty={t('trendEmpty')}
        />
      ) : null}
    </div>
  );
}
