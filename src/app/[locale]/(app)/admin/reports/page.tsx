import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Ban, CheckCheck, EyeOff, Search, ShieldAlert, ThumbsUp } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { ReportStatusBadge } from '@/components/admin/badges';
import { FilterTabs, PageHeader, Pager } from '@/components/admin/kit';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { must, mustPage } from '@/lib/admin/read';
import { hrefWith, oneOf, pageOf, param, rangeOf, type SearchParams } from '@/lib/admin/params';
import { formatDate } from '@/lib/utils';
import type { JobStatus, ReportReason, ReportStatus, ReportTargetType } from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('reports'), robots: { index: false, follow: false } };
}

const VIEWS = ['open', 'investigating', 'resolved', 'dismissed'] as const;
const TYPES = ['all', 'job', 'company', 'agent'] as const;

/** How many open reports the queue draws at once. Grouped, this is far more cards than a morning's work. */
const OPEN_LIMIT = 500;
const CLOSED_PAGE = 30;

type ReportRow = {
  id: string;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  created_at: string;
  resolved_at: string | null;
  job_id: string | null;
  company_id: string | null;
  agent_id: string | null;
  reporter: { id: string; full_name: string } | null;
  job: {
    id: string;
    title_ar: string;
    title_en: string | null;
    status: JobStatus;
    expires_at: string | null;
    company: { name_ar: string; name_en: string | null } | null;
  } | null;
  company: { id: string; name_ar: string; name_en: string | null; suspended_at?: string | null } | null;
  agent: { id: string; slug: string; restricted_at?: string | null; profile: { full_name: string } | null } | null;
};

type Case = {
  type: ReportTargetType;
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
  /** Whether the matching takedown still has something to take down. */
  actionable: boolean;
  reports: ReportRow[];
  since: string;
};

/**
 * Reports, grouped by what they are about.
 *
 * A listing, a company or a consultant's profile: the unit of work is the
 * target, because five reports about one advert are five people describing
 * one problem (one report per person per target is a unique index). Handling
 * them one row at a time threw that signal away and made the reviewer close
 * the same complaint five times.
 *
 * Each verb moves every open report on the target together, and "resolve and
 * take down" does both in one transaction — the resolution cannot be recorded
 * while the harm stays up. Reporters whose past reports mostly found nothing
 * are flagged, which is the defence against somebody using the queue as a
 * weapon rather than a signal.
 */
export default async function AdminReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin(locale);

  const sp = await searchParams;
  const view = oneOf(param(sp, 'status'), VIEWS, 'open');
  const type = oneOf(param(sp, 'type'), TYPES, 'all');
  const page = pageOf(sp);
  const current = { status: view === 'open' ? undefined : view, type: type === 'all' ? undefined : type };

  const supabase = await createClient();
  let query = supabase
    .from('reports')
    .select(
      `id, reason, detail, status, created_at, resolved_at, job_id, company_id, agent_id,
       reporter:profiles!reports_reporter_id_fkey (id, full_name),
       job:jobs (id, title_ar, title_en, status, expires_at, company:companies (name_ar, name_en)),
       company:companies!reports_company_id_fkey (id, name_ar, name_en, suspended_at),
       agent:agent_profiles (id, slug, restricted_at, profile:profiles (full_name))`,
      { count: 'exact' },
    );

  if (view === 'open') query = query.in('status', ['open', 'investigating']);
  else query = query.eq('status', view);

  if (type === 'job') query = query.not('job_id', 'is', null);
  if (type === 'company') query = query.not('company_id', 'is', null);
  if (type === 'agent') query = query.not('agent_id', 'is', null);

  const grouped = view === 'open' || view === 'investigating';
  if (grouped) {
    query = query.order('created_at', { ascending: true }).limit(OPEN_LIMIT);
  } else {
    const [from, to] = rangeOf(page, CLOSED_PAGE);
    query = query.order('resolved_at', { ascending: false, nullsFirst: false }).order('id').range(from, to);
  }

  const read = grouped
    ? must(await query, 'loading the reports queue')
    : await mustPage(await query, 'loading closed reports', locale, hrefWith('/admin/reports', current, {}));
  const rows = read.data as unknown as ReportRow[];

  // How often each reporter in view has been right, from their whole history.
  const reporterIds = [...new Set(rows.map((r) => r.reporter?.id).filter(Boolean))] as string[];
  const history = reporterIds.length
    ? (must(
        await supabase.from('reports').select('reporter_id, status').in('reporter_id', reporterIds),
        'loading reporter history',
      ).data as { reporter_id: string; status: ReportStatus }[])
    : [];
  const noisy = new Set(
    reporterIds.filter((id) => {
      const mine = history.filter((h) => h.reporter_id === id);
      const dismissed = mine.filter((h) => h.status === 'dismissed').length;
      return mine.length >= 3 && dismissed / mine.length >= 0.5;
    }),
  );

  const t = await getTranslations('admin');
  const tReason = await getTranslations('reportReason');

  const caseOf = (row: ReportRow): Case | null => {
    if (row.job_id && row.job) {
      return {
        type: 'job',
        id: row.job.id,
        label: localized(locale, row.job.title_ar, row.job.title_en),
        sublabel: row.job.company ? localized(locale, row.job.company.name_ar, row.job.company.name_en) : null,
        href: `/admin/jobs/${row.job.id}`,
        actionable: row.job.status === 'active' || row.job.status === 'pending_review',
        reports: [],
        since: row.created_at,
      };
    }
    if (row.company_id && row.company) {
      return {
        type: 'company',
        id: row.company.id,
        label: localized(locale, row.company.name_ar, row.company.name_en),
        sublabel: null,
        href: `/admin/companies/${row.company.id}`,
        actionable: !row.company.suspended_at,
        reports: [],
        since: row.created_at,
      };
    }
    if (row.agent_id && row.agent) {
      return {
        type: 'agent',
        id: row.agent.id,
        label: row.agent.profile?.full_name ?? row.agent.slug,
        sublabel: row.agent.slug,
        href: `/admin/agents/${row.agent.id}`,
        actionable: !row.agent.restricted_at,
        reports: [],
        since: row.created_at,
      };
    }
    return null;
  };

  const cases = new Map<string, Case>();
  for (const row of rows) {
    const c = caseOf(row);
    if (!c) continue;
    const key = `${c.type}:${c.id}`;
    const existing = cases.get(key) ?? c;
    existing.reports.push(row);
    cases.set(key, existing);
  }
  // Most-reported first; among equals, whoever has waited longest.
  const queue = [...cases.values()].sort(
    (a, b) => b.reports.length - a.reports.length || a.since.localeCompare(b.since),
  );

  const takeDown: Record<ReportTargetType, { label: string; body: string; icon: React.ReactNode }> = {
    job: { label: t('resolveTakeDownJob'), body: t('resolveTakeDownJobBody'), icon: <EyeOff /> },
    company: { label: t('resolveSuspendCompany'), body: t('resolveSuspendCompanyBody'), icon: <Ban /> },
    agent: { label: t('resolveRestrictAgent'), body: t('resolveRestrictAgentBody'), icon: <ShieldAlert /> },
  };

  const reportLine = (report: ReportRow) => (
    <li key={report.id} className="rounded-lg border border-border/60 bg-muted/40 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{tReason(report.reason)}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {report.status === 'investigating' ? <ReportStatusBadge status="investigating" /> : null}
          {formatDate(report.created_at, locale)}
        </span>
      </div>
      {report.detail ? <p className="mt-1.5 leading-relaxed text-muted-foreground">{report.detail}</p> : null}
      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {report.reporter ? (
          <Link href={`/admin/users/${report.reporter.id}`} className="hover:underline">
            {report.reporter.full_name}
          </Link>
        ) : (
          t('unknownActor')
        )}
        {report.reporter && noisy.has(report.reporter.id) ? <Badge variant="warning">{t('noisyReporter')}</Badge> : null}
      </p>
    </li>
  );

  return (
    <div className="space-y-5">
      <PageHeader title={t('reports')} lede={t('reportsLede')} />

      <FilterTabs
        label={t('colStatus')}
        items={VIEWS.map((value) => ({
          key: value,
          label: t(`reportStatus.${value}`),
          href: hrefWith('/admin/reports', current, { status: value === 'open' ? undefined : value }),
          active: view === value,
        }))}
      />
      <FilterTabs
        label={t('reportTarget')}
        items={TYPES.map((value) => ({
          key: value,
          label: value === 'all' ? t('filterAll') : t(`kind.${value}`),
          href: hrefWith('/admin/reports', current, { type: value === 'all' ? undefined : value }),
          active: type === value,
        }))}
      />

      {grouped ? (
        queue.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            {t('emptyQueue')}
          </p>
        ) : (
          <ul className="space-y-3">
            {queue.map((c) => (
              <li key={`${c.type}:${c.id}`} className="rounded-xl border border-border bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{t(`kind.${c.type}`)}</p>
                    <h2 className="font-semibold break-words">
                      <Link href={c.href} className="hover:text-primary hover:underline">
                        {c.label}
                      </Link>
                    </h2>
                    {c.sublabel ? <p className="text-sm text-muted-foreground">{c.sublabel}</p> : null}
                  </div>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={c.reports.length > 1 ? 'destructive' : 'outline'} size="lg">
                      {t('reportCount', { count: c.reports.length })}
                    </Badge>
                    {!c.actionable ? <Badge variant="outline">{t('alreadyActioned')}</Badge> : null}
                  </span>
                </div>

                <ul className="mt-3 space-y-2">{c.reports.map(reportLine)}</ul>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {c.reports.some((r) => r.status === 'open') ? (
                    <ConfirmAction
                      lever={{ do: 'reports', targetType: c.type, targetId: c.id, status: 'investigating' }}
                      label={t('investigate')}
                      title={t('investigate')}
                      body={t('investigateBody')}
                      reason="optional"
                      icon={<Search />}
                    />
                  ) : null}
                  {c.actionable ? (
                    <ConfirmAction
                      lever={{ do: 'reports', targetType: c.type, targetId: c.id, status: 'resolved', takeAction: true }}
                      label={takeDown[c.type].label}
                      title={takeDown[c.type].label}
                      body={takeDown[c.type].body}
                      reason="required"
                      reasonLabel={t('reasonToOwner')}
                      variant="destructive"
                      icon={takeDown[c.type].icon}
                    />
                  ) : null}
                  <ConfirmAction
                    lever={{ do: 'reports', targetType: c.type, targetId: c.id, status: 'resolved' }}
                    label={t('resolveOnly')}
                    title={t('resolveOnly')}
                    body={t('resolveOnlyBody')}
                    reason="optional"
                    icon={<CheckCheck />}
                  />
                  <ConfirmAction
                    lever={{ do: 'reports', targetType: c.type, targetId: c.id, status: 'dismissed' }}
                    label={t('dismissReports')}
                    title={t('dismissReports')}
                    body={t('dismissBody')}
                    reason="optional"
                    variant="ghost"
                    icon={<ThumbsUp />}
                  />
                </div>
              </li>
            ))}
          </ul>
        )
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          {t('emptyQueue')}
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map((report) => {
              const c = caseOf(report);
              return (
                <li key={report.id} className="rounded-xl border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">
                    {c ? t(`kind.${c.type}`) : null}
                    {report.resolved_at ? ` · ${formatDate(report.resolved_at, locale)}` : null}
                  </p>
                  {c ? (
                    <Link href={c.href} className="font-medium hover:text-primary hover:underline">
                      {c.label}
                    </Link>
                  ) : null}
                  <ul className="mt-2">{reportLine(report)}</ul>
                </li>
              );
            })}
          </ul>
          <Pager
            page={page}
            total={read.count}
            size={CLOSED_PAGE}
            locale={locale}
            buildHref={(next) => hrefWith('/admin/reports', current, { page: next })}
          />
        </>
      )}

      {grouped && rows.length >= OPEN_LIMIT ? (
        <p className="text-center text-sm text-warning">{t('reportsCapped', { count: OPEN_LIMIT })}</p>
      ) : null}
    </div>
  );
}
