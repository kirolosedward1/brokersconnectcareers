import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { StatStrip } from '@/components/dashboard/stat-tile';
import { TrendChart } from '@/components/dashboard/trend-chart';
import { PageHeader, SearchForm, Section, auditLabel } from '@/components/admin/kit';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { must } from '@/lib/admin/read';
import { formatDate, formatNumber } from '@/lib/utils';
import type { AdminOverview, AdminTrend } from '@/lib/supabase/database.types';

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
 * Where an operator starts the day.
 *
 * Three rows, in the order they are acted on: what is waiting on a person, the
 * health of the marketplace, and the two populations it serves. Every number
 * is a count the database made just now (admin_overview, one round trip), and
 * every one links to the filtered list behind it — a number you cannot open
 * is a number you cannot act on.
 *
 * Live means the date, not the label, exactly as the board decides it.
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
  const [overview, { data: trendData }] = await Promise.all([
    supabase.rpc('admin_overview'),
    supabase.rpc('admin_trend'),
  ]);
  const o = must(overview, 'loading the admin overview').data as AdminOverview;
  const trend = (trendData ?? null) as AdminTrend | null;

  const t = await getTranslations('dashboard');
  const tAdmin = await getTranslations('admin');
  const n = (value: number) => formatNumber(value, locale);

  const appsDelta = o.applications.last_7d - o.applications.prev_7d;

  return (
    <div className="space-y-6">
      <PageHeader title={t('overview')} lede={tAdmin('overviewLede')} />

      <SearchForm
        locale={locale}
        path="/admin/search"
        placeholder={tAdmin('searchEverythingPlaceholder')}
        label={tAdmin('search')}
      />

      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-muted-foreground">{tAdmin('needsAttention')}</h2>
        <StatStrip
          label={tAdmin('needsAttention')}
          cells={[
            {
              label: t('statQueue'),
              value: n(o.jobs.pending),
              href: '/admin/jobs',
              tone: o.jobs.pending > 0 ? 'accent' : 'default',
            },
            {
              label: t('statQueueOld'),
              value: n(o.jobs.pending_24h),
              href: '/admin/jobs',
              tone: o.jobs.pending_24h > 0 ? 'urgent' : 'default',
            },
            {
              label: t('statReports'),
              value: n(o.reports.open_targets),
              href: '/admin/reports',
              tone: o.reports.open_targets > 0 ? 'warn' : 'default',
            },
            {
              label: t('statCompaniesPending'),
              value: n(o.companies.pending),
              href: '/admin/companies?status=pending',
              tone: o.companies.pending > 0 ? 'warn' : 'default',
            },
            {
              label: tAdmin('statAccountsPending'),
              value: n(o.accounts.pending),
              href: '/admin/users?status=pending',
              tone: o.accounts.pending > 0 ? 'warn' : 'default',
            },
          ]}
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-muted-foreground">{tAdmin('marketplace')}</h2>
        <StatStrip
          label={tAdmin('marketplace')}
          cells={[
            { label: t('statLiveJobs'), value: n(o.jobs.live), href: '/admin/jobs?status=live', tone: 'good' },
            {
              label: t('statExpiring'),
              value: n(o.jobs.expiring_7d),
              href: '/admin/jobs?status=expiring',
              tone: o.jobs.expiring_7d > 0 ? 'warn' : 'default',
            },
            {
              label: tAdmin('statNoApplicants'),
              value: n(o.jobs.live_no_applicants),
              href: '/admin/jobs?status=quiet',
              tone: o.jobs.live_no_applicants > 0 ? 'warn' : 'default',
            },
            { label: tAdmin('statExpired'), value: n(o.jobs.expired), href: '/admin/jobs?status=expired' },
            {
              label: tAdmin('statApplications7d'),
              value: n(o.applications.last_7d),
              href: '/admin/applications',
              delta:
                appsDelta === 0
                  ? undefined
                  : { value: n(Math.abs(appsDelta)), direction: appsDelta > 0 ? 'up' : 'down' },
            },
            {
              label: tAdmin('statUnopened'),
              value: n(o.applications.unopened_7d),
              href: '/admin/applications?status=unopened',
              tone: o.applications.unopened_7d > 0 ? 'warn' : 'default',
            },
          ]}
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-muted-foreground">{tAdmin('population')}</h2>
        <StatStrip
          label={tAdmin('population')}
          cells={[
            { label: tAdmin('statCompaniesHiring'), value: n(o.companies.hiring), href: '/admin/companies?status=all' },
            { label: tAdmin('statCompaniesVerified'), value: n(o.companies.verified), href: '/admin/companies?status=verified' },
            { label: tAdmin('statCandidates'), value: n(o.accounts.candidates), href: '/admin/users?role=candidate' },
            { label: tAdmin('statEmployers'), value: n(o.accounts.employers), href: '/admin/users?role=employer' },
            { label: t('statSignups'), value: n(o.accounts.signups_7d), href: '/admin/users' },
            { label: tAdmin('statAgents'), value: n(o.agents.public + o.agents.gated), href: '/admin/agents', hint: tAdmin('statAgentsHint', { hidden: n(o.agents.hidden) }) },
            {
              label: tAdmin('statSuspendedAccounts'),
              value: n(o.accounts.suspended),
              href: '/admin/users?status=rejected',
              tone: 'default',
            },
            {
              label: tAdmin('statSuspendedCompanies'),
              value: n(o.companies.suspended),
              href: '/admin/companies?status=suspended',
              tone: 'default',
            },
            {
              label: tAdmin('statRestrictedConsultants'),
              value: n(o.agents.restricted),
              href: '/admin/agents?visibility=restricted',
              tone: 'default',
            },
          ]}
        />
      </div>

      {trend ? (
        <TrendChart
          id="admin-activity"
          title={t('trendActivityTitle')}
          hint={t('trendActivityHint')}
          days={trend.days.map((day) => day.d)}
          series={[
            { key: 'applications', label: t('statApplications'), tone: 'primary', values: trend.days.map((day) => day.applications) },
            { key: 'published', label: t('trendPublished'), tone: 'success', values: trend.days.map((day) => day.published) },
            { key: 'signups', label: t('trendSignups'), tone: 'warning', values: trend.days.map((day) => day.signups) },
          ]}
          locale={locale}
          empty={t('trendEmpty')}
        />
      ) : null}

      <Section
        title={tAdmin('recentActivity')}
        actions={
          <Link href="/admin/audit" className="text-xs text-primary hover:underline">
            {tAdmin('auditLog')}
          </Link>
        }
      >
        {o.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tAdmin('trailEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {o.recent.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{auditLabel(tAdmin, entry.action)}</span>
                  {entry.target_label ? (
                    <span className="text-muted-foreground"> — {entry.target_label}</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {entry.actor_name ?? tAdmin('unknownActor')} · {formatDate(entry.created_at, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
