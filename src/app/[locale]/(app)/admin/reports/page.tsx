import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Ban, CheckCheck, EyeOff, Search, ShieldAlert, ThumbsUp, UserX } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localeHref, localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { JobStatusBadge, ReportStatusBadge } from '@/components/admin/badges';
import { FilterTabs, PageHeader, Pager } from '@/components/admin/kit';
import { CompanySignalList, SafetyFlags, SeverityBadge } from '@/components/admin/safety';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { leaveAnEmptyPage, must } from '@/lib/admin/read';
import { cairoDayStart, dayOf, hrefWith, oneOf, pageOf, param, type SearchParams } from '@/lib/admin/params';
import { formatDate, formatNumber } from '@/lib/utils';
import type {
  AdminReportCase,
  AdminReportDetail,
  CompanySignals,
  JobStatus,
  ReportReason,
  ReportTargetType,
  SafetyFlag,
} from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('reports'), robots: { index: false, follow: false } };
}

const VIEWS = ['new', 'under_review', 'resolved', 'dismissed'] as const;
type View = (typeof VIEWS)[number];
const TYPES = ['all', 'job', 'company', 'agent'] as const;
const REASONS = [
  'scam',
  'fake_listing',
  'impersonation',
  'harassment',
  'suspicious_company',
  'misleading_pay',
  'inappropriate',
  'discriminatory',
  'spam',
  'duplicate',
  'other',
] as const satisfies readonly ReportReason[];
const SEVERITIES = ['any', '3', '2'] as const;

const CASE_PAGE = 20;
const CLOSED_PAGE = 30;

const JOB_STATUSES: readonly string[] = ['draft', 'pending_review', 'active', 'expired', 'closed', 'rejected'];

/**
 * Reports, one case per thing reported.
 *
 * New and under review are cases: every open report about one listing,
 * company or consultant profile, ranked by what was alleged (severity, from
 * the reason alone), then by how many different people said it, then by who
 * has waited longest — aggregated in the database (admin_report_cases), not
 * drawn five hundred rows at a time and grouped here. Resolved and dismissed
 * are the reports themselves, newest decision first.
 *
 * Beside each case: what the listing or company says about itself (text
 * flags), what the company has been doing (review signals), and who the
 * reporters are — new accounts, a record of groundless reports, employers.
 * Those three separate a real pile of complaints from a pile-on. None of it
 * decides anything; every lever is a person's decision, with a reason.
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
  const view: View = oneOf(param(sp, 'status'), VIEWS, 'new');
  const type = oneOf(param(sp, 'type'), TYPES, 'all');
  const reason = oneOf(param(sp, 'reason'), ['all', ...REASONS] as const, 'all');
  const severity = oneOf(param(sp, 'severity'), SEVERITIES, 'any');
  const from = dayOf(param(sp, 'from'));
  const to = dayOf(param(sp, 'to'));
  const repeat = param(sp, 'repeat') === '1';
  const page = pageOf(sp);

  const current = {
    status: view === 'new' ? undefined : view,
    type: type === 'all' ? undefined : type,
    reason: reason === 'all' ? undefined : reason,
    severity: severity === 'any' ? undefined : severity,
    from,
    to,
    repeat: repeat ? '1' : undefined,
  };
  const filters = {
    p_type: type === 'all' ? null : type,
    p_reason: reason === 'all' ? null : reason,
    p_min_severity: severity === 'any' ? null : Number(severity),
    p_from: from ? cairoDayStart(from) : null,
    p_to: to ? cairoDayStart(to, 1) : null,
  };

  const supabase = await createClient();
  const t = await getTranslations('admin');
  const tReason = await getTranslations('reportReason');
  const grouped = view === 'new' || view === 'under_review';

  let cases: AdminReportCase[] = [];
  let rows: AdminReportDetail[] = [];
  let total = 0;
  const jobSignals = new Map<string, { flags: SafetyFlag[]; company: CompanySignals }>();
  const companySignals = new Map<string, { flags: SafetyFlag[]; signals: CompanySignals }>();

  if (grouped) {
    cases = must(
      await supabase.rpc('admin_report_cases', {
        p_view: view,
        ...filters,
        p_min_reporters: repeat ? 2 : null,
        p_limit: CASE_PAGE,
        p_offset: (page - 1) * CASE_PAGE,
      }),
      'loading the reports queue',
    ).data ?? [];
    total = Number(cases[0]?.total_count ?? 0);

    const ids = cases.flatMap((item) => item.report_ids);
    const jobIds = cases.filter((item) => item.target_type === 'job' && item.target_state !== 'deleted').map((item) => item.target_id);
    const companyIds = cases
      .filter((item) => item.target_type === 'company' && item.target_state !== 'deleted')
      .map((item) => item.target_id);

    const [details, jobs, companies] = await Promise.all([
      ids.length ? supabase.rpc('admin_report_rows', { p_ids: ids }) : Promise.resolve({ data: [], error: null }),
      jobIds.length ? supabase.rpc('admin_job_signals', { p_jobs: jobIds }) : Promise.resolve({ data: [], error: null }),
      companyIds.length
        ? supabase.rpc('admin_company_signals', { p_companies: companyIds })
        : Promise.resolve({ data: [], error: null }),
    ]);
    rows = must(details, 'loading the reports behind each case').data ?? [];
    for (const row of must(jobs, 'loading listing signals').data ?? []) {
      jobSignals.set(row.job_id, { flags: row.flags, company: row.company_signals });
    }
    for (const row of must(companies, 'loading company signals').data ?? []) {
      companySignals.set(row.company_id, { flags: row.flags, signals: row.signals });
    }
  } else {
    rows = must(
      await supabase.rpc('admin_report_rows', {
        p_status: view,
        ...filters,
        p_limit: CLOSED_PAGE,
        p_offset: (page - 1) * CLOSED_PAGE,
      }),
      'loading closed reports',
    ).data ?? [];
    total = Number(rows[0]?.total_count ?? 0);
  }
  // Resolving the last case on a later page refreshes that page empty, its
  // total read as 0 — "nothing waiting" over a page one still full of cases.
  await leaveAnEmptyPage(locale, {
    page,
    rows: grouped ? cases.length : rows.length,
    total,
    size: grouped ? CASE_PAGE : CLOSED_PAGE,
    href: (n) => hrefWith('/admin/reports', current, { page: n }),
  });

  const byId = new Map(rows.map((row) => [row.id, row]));
  const n = (value: number) => formatNumber(value, locale);

  const takeDown: Record<ReportTargetType, { label: string; body: string; icon: React.ReactNode }> = {
    job: { label: t('resolveTakeDownJob'), body: t('resolveTakeDownJobBody'), icon: <EyeOff aria-hidden /> },
    company: { label: t('resolveSuspendCompany'), body: t('resolveSuspendCompanyBody'), icon: <Ban aria-hidden /> },
    agent: { label: t('resolveRestrictAgent'), body: t('resolveRestrictAgentBody'), icon: <ShieldAlert aria-hidden /> },
  };

  const hrefOf = (targetType: ReportTargetType, id: string) =>
    targetType === 'job' ? `/admin/jobs/${id}` : targetType === 'company' ? `/admin/companies/${id}` : `/admin/agents/${id}`;

  const stateBadge = (item: { target_type: ReportTargetType; target_state: string }) => {
    if (item.target_state === 'deleted') return <Badge variant="outline">{t('stateDeleted')}</Badge>;
    if (item.target_state === 'suspended' || item.target_state === 'company_suspended') {
      return <Badge variant="destructive">{t('suspended')}</Badge>;
    }
    if (item.target_state === 'restricted') return <Badge variant="destructive">{t('restricted')}</Badge>;
    if (item.target_type === 'job' && JOB_STATUSES.includes(item.target_state)) {
      return <JobStatusBadge status={item.target_state as JobStatus} expiresAt={null} />;
    }
    return null;
  };

  const reportLine = (report: AdminReportDetail, withLevers: boolean) => {
    const fresh = report.reporter_since
      ? new Date(report.created_at).getTime() - new Date(report.reporter_since).getTime() < 7 * 86_400_000
      : false;
    return (
      <li key={report.id} className="rounded-lg border border-border/60 bg-muted/40 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{tReason(report.reason)}</span>
            <SeverityBadge severity={report.severity} />
            {report.status === 'investigating' ? <ReportStatusBadge status="investigating" /> : null}
            {report.abusive ? <Badge variant="warning">{t('badFaith')}</Badge> : null}
          </span>
          <span className="text-xs text-muted-foreground">{formatDate(report.created_at, locale)}</span>
        </div>

        {report.detail ? (
          <p className="mt-1.5 leading-relaxed text-muted-foreground" dir="auto">
            {report.detail}
          </p>
        ) : null}

        {report.source === 'system' ? (
          <p className="mt-1.5 text-xs text-muted-foreground">{t('systemFlag')}</p>
        ) : (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {report.reporter_id ? (
              <Link href={`/admin/users/${report.reporter_id}`} className="hover:underline">
                {report.reporter_name}
              </Link>
            ) : (
              <span>{t('reporterGone')}</span>
            )}
            {report.reporter_role === 'employer' ? (
              <span>
                · {t('reporterEmployer')}
                {report.reporter_company_ar ? ` (${localized(locale, report.reporter_company_ar, report.reporter_company_en)})` : ''}
              </span>
            ) : null}
            {report.reporter_id ? (
              <span>
                ·{' '}
                {t('reporterRecord', {
                  filed: n(report.reporter_filed),
                  dismissed: n(report.reporter_dismissed),
                  abusive: n(report.reporter_abusive),
                })}
              </span>
            ) : null}
            {fresh ? <Badge variant="warning">{t('reporterNewAccount')}</Badge> : null}
            {report.reporter_restricted ? <Badge variant="destructive">{t('reporterBanned')}</Badge> : null}
          </p>
        )}

        {withLevers && report.source === 'user' && (report.status === 'open' || report.status === 'investigating') ? (
          <div className="mt-2">
            <ConfirmAction
              lever={{ do: 'closeReports', ids: [report.id], status: 'dismissed', abusive: true }}
              label={t('dismissAbusive')}
              title={t('dismissAbusive')}
              body={t('dismissAbusiveBody')}
              reason="required"
              reasonLabel={t('abusiveReasonLabel')}
              variant="ghost"
              icon={<UserX aria-hidden />}
            />
          </div>
        ) : null}
      </li>
    );
  };

  const caseCard = (item: AdminReportCase) => {
    const reports = item.report_ids.map((id) => byId.get(id)).filter(Boolean) as AdminReportDetail[];
    const deleted = item.target_state === 'deleted';
    const live = !deleted;
    const actionable =
      live &&
      (item.target_type === 'job'
        ? item.target_state === 'active' || item.target_state === 'pending_review'
        : item.target_type === 'company'
          ? item.target_state === 'listed'
          : item.target_state !== 'restricted');
    const openIds = reports.filter((row) => row.status === 'open' || row.status === 'investigating').map((row) => row.id);
    const snapshot = reports[0]?.target_snapshot;
    const job = item.target_type === 'job' ? jobSignals.get(item.target_id) : undefined;
    const company = item.target_type === 'company' ? companySignals.get(item.target_id) : undefined;
    const label = localized(locale, item.label_ar ?? '', item.label_en) || t('untitled');

    return (
      <li key={`${item.target_type}:${item.target_id}`} className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{t(`kind.${item.target_type}`)}</p>
            <h2 className="font-semibold break-words">
              {live ? (
                <Link href={hrefOf(item.target_type, item.target_id)} className="hover:text-primary hover:underline">
                  {label}
                </Link>
              ) : (
                label
              )}
            </h2>
            {item.target_type === 'job' && item.company_name_ar ? (
              <p className="text-sm text-muted-foreground">
                {item.company_id && live ? (
                  <Link href={`/admin/companies/${item.company_id}`} className="hover:underline">
                    {localized(locale, item.company_name_ar, item.company_name_en)}
                  </Link>
                ) : (
                  localized(locale, item.company_name_ar, item.company_name_en)
                )}
              </p>
            ) : null}
          </div>
          <span className="flex flex-wrap items-center gap-1.5">
            <SeverityBadge severity={item.max_severity} />
            {stateBadge(item)}
            <Badge variant={item.reporters > 1 ? 'destructive' : 'outline'} size="lg">
              {t('reportersCount', { count: n(item.reporters) })}
            </Badge>
            {item.system_flags ? <Badge variant="warning">{t('systemFlagShort')}</Badge> : null}
          </span>
        </div>

        {item.fresh_reporters || item.noisy_reporters || item.employer_reporters ? (
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {item.fresh_reporters ? <span>{t('freshReporters', { count: n(item.fresh_reporters) })}</span> : null}
            {item.noisy_reporters ? (
              <span className="text-warning">{t('noisyReporters', { count: n(item.noisy_reporters) })}</span>
            ) : null}
            {item.employer_reporters ? (
              <span>{t('employerReporters', { count: n(item.employer_reporters) })}</span>
            ) : null}
          </p>
        ) : null}

        {deleted && snapshot?.excerpt ? (
          <div className="mt-3 border-s-2 border-border ps-3 text-sm">
            <p className="text-xs text-muted-foreground">{t('snapshotLabel')}</p>
            <p className="mt-1 line-clamp-4 whitespace-pre-line" dir="auto">
              {snapshot.excerpt}
            </p>
          </div>
        ) : null}

        {job && (job.flags.length || job.company.signals.length) ? (
          <div className="mt-3 space-y-2 border-s-2 border-warning/60 ps-3">
            <SafetyFlags flags={job.flags} />
            <CompanySignalList signals={job.company} locale={locale} />
          </div>
        ) : null}
        {company && (company.flags.length || company.signals.signals.length) ? (
          <div className="mt-3 space-y-2 border-s-2 border-warning/60 ps-3">
            <SafetyFlags flags={company.flags} />
            <CompanySignalList signals={company.signals} locale={locale} />
          </div>
        ) : null}

        <ul className="mt-3 space-y-2">{reports.map((report) => reportLine(report, true))}</ul>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {live ? (
            <>
              {item.open_reports > 0 ? (
                <ConfirmAction
                  lever={{ do: 'reports', targetType: item.target_type, targetId: item.target_id, status: 'investigating' }}
                  label={t('investigate')}
                  title={t('investigate')}
                  body={t('investigateBody')}
                  reason="optional"
                  icon={<Search aria-hidden />}
                />
              ) : null}
              {actionable ? (
                <ConfirmAction
                  lever={{
                    do: 'reports',
                    targetType: item.target_type,
                    targetId: item.target_id,
                    status: 'resolved',
                    takeAction: true,
                  }}
                  label={takeDown[item.target_type].label}
                  title={takeDown[item.target_type].label}
                  body={takeDown[item.target_type].body}
                  reason="required"
                  // Who reads it: a listing's company and a company's members get the
                  // reason with the take-down, a consultant gets it on their profile.
                  reasonLabel={item.target_type === 'agent' ? t('reasonToConsultant') : t('reasonToCompany')}
                  variant="destructive"
                  icon={takeDown[item.target_type].icon}
                />
              ) : null}
              <ConfirmAction
                lever={{ do: 'reports', targetType: item.target_type, targetId: item.target_id, status: 'resolved' }}
                label={t('resolveOnly')}
                title={t('resolveOnly')}
                body={t('resolveOnlyBody')}
                reason="optional"
                icon={<CheckCheck aria-hidden />}
              />
              <ConfirmAction
                lever={{ do: 'reports', targetType: item.target_type, targetId: item.target_id, status: 'dismissed' }}
                label={t('dismissReports')}
                title={t('dismissReports')}
                body={t('dismissBody')}
                reason="optional"
                variant="ghost"
                icon={<ThumbsUp aria-hidden />}
              />
            </>
          ) : openIds.length ? (
            <>
              <ConfirmAction
                lever={{ do: 'closeReports', ids: openIds, status: 'resolved' }}
                label={t('closeDeletedResolve')}
                title={t('closeDeletedResolve')}
                body={t('closeDeletedBody')}
                reason="optional"
                icon={<CheckCheck aria-hidden />}
              />
              <ConfirmAction
                lever={{ do: 'closeReports', ids: openIds, status: 'dismissed' }}
                label={t('closeDeletedDismiss')}
                title={t('closeDeletedDismiss')}
                body={t('closeDeletedBody')}
                reason="optional"
                variant="ghost"
                icon={<ThumbsUp aria-hidden />}
              />
            </>
          ) : null}
        </div>
      </li>
    );
  };

  const closedRow = (report: AdminReportDetail) => {
    const label = localized(locale, report.target_snapshot.label_ar ?? '', report.target_snapshot.label_en) || t('untitled');
    return (
      <li key={report.id} className="rounded-xl border border-border bg-card p-3">
        <p className="text-xs text-muted-foreground">
          {t(`kind.${report.target_type}`)}
          {report.resolved_at ? ` · ${formatDate(report.resolved_at, locale)}` : null}
          {!report.target_live ? ` · ${t('stateDeleted')}` : null}
        </p>
        {report.target_live ? (
          <Link href={hrefOf(report.target_type, report.target_id)} className="font-medium hover:text-primary hover:underline">
            {label}
          </Link>
        ) : (
          <span className="font-medium">{label}</span>
        )}
        <ul className="mt-2">{reportLine(report, false)}</ul>
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t('reports')} lede={t('reportsLede')} />

      <FilterTabs
        label={t('colStatus')}
        items={VIEWS.map((value) => ({
          key: value,
          label: t(`reportView.${value}`),
          href: hrefWith('/admin/reports', current, { status: value === 'new' ? undefined : value }),
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

      <ReportFilters
        locale={locale}
        keep={{ status: current.status, type: current.type }}
        reason={reason}
        severity={severity}
        from={from}
        to={to}
        repeat={repeat}
        grouped={grouped}
      />

      {grouped ? (
        cases.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            {t('emptyQueue')}
          </p>
        ) : (
          <ul className="space-y-3">{cases.map(caseCard)}</ul>
        )
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          {t('emptyQueue')}
        </p>
      ) : (
        <ul className="space-y-2">{rows.map(closedRow)}</ul>
      )}

      <Pager
        page={page}
        total={total}
        size={grouped ? CASE_PAGE : CLOSED_PAGE}
        locale={locale}
        buildHref={(next) => hrefWith('/admin/reports', current, { page: next })}
      />
    </div>
  );
}

/**
 * The finer filters, as a plain GET form: it works before hydration, and the
 * result is a URL a moderator can send to a colleague.
 */
async function ReportFilters({
  locale,
  keep,
  reason,
  severity,
  from,
  to,
  repeat,
  grouped,
}: {
  locale: Locale;
  keep: Record<string, string | undefined>;
  reason: string;
  severity: string;
  from?: string;
  to?: string;
  repeat: boolean;
  grouped: boolean;
}) {
  const t = await getTranslations('admin');
  const tReason = await getTranslations('reportReason');
  const control =
    'h-10 rounded-lg border border-input bg-card px-2.5 text-sm focus-visible:border-ring';

  return (
    <form
      method="get"
      action={localeHref(locale, '/admin/reports')}
      aria-label={t('filtersLabel')}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3"
    >
      {Object.entries(keep).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('filterReason')}
        <select name="reason" defaultValue={reason} className={control}>
          <option value="all">{t('anyReason')}</option>
          {REASONS.map((value) => (
            <option key={value} value={value}>
              {tReason(value)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('filterSeverity')}
        <select name="severity" defaultValue={severity} className={control}>
          <option value="any">{t('anySeverity')}</option>
          <option value="3">{t('severityOnlyHigh')}</option>
          <option value="2">{t('severityMediumUp')}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('filterFrom')}
        <input type="date" name="from" defaultValue={from} className={control} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('filterTo')}
        <input type="date" name="to" defaultValue={to} className={control} />
      </label>
      {grouped ? (
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" name="repeat" value="1" defaultChecked={repeat} className="size-4 accent-primary" />
          {t('filterRepeat')}
        </label>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" className="h-10 rounded-lg border border-border bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          {t('applyFilters')}
        </button>
        <Link
          href={hrefWith('/admin/reports', keep, {})}
          className="inline-flex h-10 items-center rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {t('clearFilters')}
        </Link>
      </div>
    </form>
  );
}
