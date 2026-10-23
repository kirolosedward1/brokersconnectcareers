import { useInfiniteQuery } from '@tanstack/react-query';
import { cairoDayStart, dayOf, oneOf } from '@/lib/admin/params';
import type {
  AdminReportCase,
  AdminReportDetail,
  CompanySignals,
  ReportReason,
  ReportTargetType,
  SafetyFlag,
} from '@/lib/supabase/database.types';
import { supabase } from '~/lib/supabase';
import { useOpen } from './record';

/**
 * Reports, as the website's /admin/reports reads them (the page's own
 * constants, filters and page sizes), under the admin's own session and only
 * through the open door (record.ts, useOpen). A failed read throws: "nothing
 * waiting" is the answer a moderator acts on by going away, so a read that
 * failed must never be able to say it.
 *
 * New and under review are cases — every open report about one listing,
 * company or consultant profile, ranked in the database (admin_report_cases)
 * — twenty a page. Resolved and dismissed are the reports themselves, newest
 * decision first (admin_report_rows with a status), thirty a page.
 */

export const REPORT_VIEWS = ['new', 'under_review', 'resolved', 'dismissed'] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];
export type OpenView = 'new' | 'under_review';
export type ClosedView = 'resolved' | 'dismissed';

export const REPORT_TYPES = ['all', 'job', 'company', 'agent'] as const;
export type ReportTypeFilter = (typeof REPORT_TYPES)[number];

/** The reasons a report can give, in the website's filter order. */
export const REPORT_REASONS = [
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

export const SEVERITIES = ['any', '3', '2'] as const;
export type SeverityFilter = (typeof SEVERITIES)[number];

export const CASE_PAGE = 20;
export const CLOSED_PAGE = 30;

/** How many of a case's reports are drawn under it, and so read; the rest are counted. */
export const SHOWN_REPORTS = 3;

/** The most reports one close-by-id lever takes (the action's own cap). */
export const CLOSE_MAX = 200;

/** The finer filters, as the website's form has them; a day is YYYY-MM-DD. */
export type ReportFilters = {
  type: ReportTypeFilter;
  reason: 'all' | ReportReason;
  severity: SeverityFilter;
  from?: string;
  to?: string;
  /** Reported by more than one person (p_min_reporters 2); cases only. */
  repeat: boolean;
};

export const NO_FILTERS: ReportFilters = { type: 'all', reason: 'all', severity: 'any', repeat: false };

export function isOpenView(view: ReportView): view is OpenView {
  return view === 'new' || view === 'under_review';
}

/**
 * The view and filters a link asks for, in the website's own query terms
 * (`?status=`, `?type=`, `?reason=`, `?severity=`, `?from=`, `?to=`,
 * `?repeat=1`), each held to the allowed set exactly as the page holds it.
 */
export function readReportParams(params: Record<string, string | string[] | undefined>): { view: ReportView; filters: ReportFilters } {
  const one = (key: string) => {
    const value = params[key];
    const text = Array.isArray(value) ? value[0] : value;
    const trimmed = text?.trim();
    return trimmed ? trimmed.slice(0, 120) : undefined;
  };
  return {
    view: oneOf(one('status'), REPORT_VIEWS, 'new'),
    filters: {
      type: oneOf(one('type'), REPORT_TYPES, 'all'),
      reason: oneOf(one('reason'), ['all', ...REPORT_REASONS] as const, 'all'),
      severity: oneOf(one('severity'), SEVERITIES, 'any'),
      from: dayOf(one('from')),
      to: dayOf(one('to')),
      repeat: one('repeat') === '1',
    },
  };
}

/** How many of the finer filters are set (the type has its own row; the repeat counts only where it applies). */
export function activeFilterCount(filters: ReportFilters, grouped: boolean): number {
  return [filters.reason !== 'all', filters.severity !== 'any', Boolean(filters.from), Boolean(filters.to), grouped && filters.repeat].filter(
    Boolean,
  ).length;
}

/** The arguments both functions share: the website's `filters` object, day boundaries in Cairo. */
function rpcFilters(filters: ReportFilters) {
  return {
    p_type: filters.type === 'all' ? null : filters.type,
    p_reason: filters.reason === 'all' ? null : filters.reason,
    p_min_severity: filters.severity === 'any' ? null : Number(filters.severity),
    p_from: filters.from ? cairoDayStart(filters.from) : null,
    p_to: filters.to ? cairoDayStart(filters.to, 1) : null,
  };
}

export type ReportCase = AdminReportCase & {
  /** The first few reports behind it, oldest first. */
  details: AdminReportDetail[];
  /** What the listing says in its own words, and what its company has been doing (live listings). */
  job: { flags: SafetyFlag[]; company: CompanySignals } | null;
  /** The company's own flags and signals (live companies). */
  company: { flags: SafetyFlag[]; signals: CompanySignals } | null;
};

type CasesPage = { cases: ReportCase[]; total: number };
type ClosedPage = { rows: AdminReportDetail[]; total: number };

/**
 * One page of open cases, most serious first, and beside each what the
 * website shows a moderator: the first reports behind it, and the listing's
 * or company's signals. Only the reports drawn are read — admin_report_rows
 * takes at most 500 ids, and a viral listing alone can collect that many —
 * and signals only for targets that still exist (deleted ones have none),
 * never more than the hundred a call takes: a page has twenty cases.
 */
export function useReportCases(view: OpenView, filters: ReportFilters) {
  const open = useOpen();
  return useInfiniteQuery({
    queryKey: ['admin', 'reports', view, filters],
    enabled: open,
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<CasesPage> => {
      const { data, error } = await supabase.rpc('admin_report_cases', {
        p_view: view,
        ...rpcFilters(filters),
        p_min_reporters: filters.repeat ? 2 : null,
        p_limit: CASE_PAGE,
        p_offset: (pageParam - 1) * CASE_PAGE,
      });
      if (error) throw error;
      const cases = data ?? [];

      const ids = cases.flatMap((item) => item.report_ids.slice(0, SHOWN_REPORTS));
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
      if (details.error) throw details.error;
      if (jobs.error) throw jobs.error;
      if (companies.error) throw companies.error;

      const byId = new Map<string, AdminReportDetail>();
      for (const row of details.data ?? []) byId.set(row.id, row);
      const jobSignals = new Map<string, ReportCase['job']>();
      for (const row of jobs.data ?? []) jobSignals.set(row.job_id, { flags: row.flags, company: row.company_signals });
      const companySignals = new Map<string, ReportCase['company']>();
      for (const row of companies.data ?? []) companySignals.set(row.company_id, { flags: row.flags, signals: row.signals });

      return {
        cases: cases.map((item) => ({
          ...item,
          details: item.report_ids.map((id) => byId.get(id)).filter((row): row is AdminReportDetail => Boolean(row)),
          job: item.target_type === 'job' ? (jobSignals.get(item.target_id) ?? null) : null,
          company: item.target_type === 'company' ? (companySignals.get(item.target_id) ?? null) : null,
        })),
        total: Number(cases[0]?.total_count ?? 0),
      };
    },
    getNextPageParam: (last, pages) =>
      pages.length * CASE_PAGE < last.total && last.cases.length > 0 ? pages.length + 1 : undefined,
  });
}

/** The closed reports of one view, newest decision first, thirty a page, under the same filters (the repeat does not apply). */
export function useClosedReports(view: ClosedView, filters: ReportFilters) {
  const open = useOpen();
  return useInfiniteQuery({
    queryKey: ['admin', 'reports', view, filters],
    enabled: open,
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<ClosedPage> => {
      const { data, error } = await supabase.rpc('admin_report_rows', {
        p_status: view,
        ...rpcFilters(filters),
        p_limit: CLOSED_PAGE,
        p_offset: (pageParam - 1) * CLOSED_PAGE,
      });
      if (error) throw error;
      const rows = data ?? [];
      return { rows, total: Number(rows[0]?.total_count ?? 0) };
    },
    getNextPageParam: (last, pages) =>
      pages.length * CLOSED_PAGE < last.total && last.rows.length > 0 ? pages.length + 1 : undefined,
  });
}

/** Every case across the pages loaded so far, each once (a case can move between pages as others close). */
export function flattenCases(pages: CasesPage[] | undefined): ReportCase[] {
  const seen = new Set<string>();
  const out: ReportCase[] = [];
  for (const page of pages ?? []) {
    for (const item of page.cases) {
      const key = `${item.target_type}:${item.target_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export function flattenClosed(pages: ClosedPage[] | undefined): AdminReportDetail[] {
  const seen = new Set<string>();
  const out: AdminReportDetail[] = [];
  for (const page of pages ?? []) {
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

/**
 * The website's path for a reported thing. A listing's review is the app's
 * own; a company's page and a consultant's profile are the console's
 * /admin/companies/<id> and /admin/agents/<id>, which links.ts already opens
 * natively.
 */
export function targetPath(type: ReportTargetType, id: string): string {
  return type === 'job' ? `/admin/jobs/${id}` : type === 'company' ? `/admin/companies/${id}` : `/admin/agents/${id}`;
}

/** The take-down a live target can still be given, as the website's case offers it. */
export function canTakeDown(item: Pick<AdminReportCase, 'target_type' | 'target_state'>): boolean {
  if (item.target_state === 'deleted') return false;
  if (item.target_type === 'job') return item.target_state === 'active' || item.target_state === 'pending_review';
  if (item.target_type === 'company') return item.target_state === 'listed';
  return item.target_state !== 'restricted';
}

/** A reporter whose account was under a week old when they reported: one of the facts beside a report. */
export function freshReporter(report: Pick<AdminReportDetail, 'created_at' | 'reporter_since'>): boolean {
  return report.reporter_since
    ? new Date(report.created_at).getTime() - new Date(report.reporter_since).getTime() < 7 * 86_400_000
    : false;
}

/** The dismiss-as-bad-faith lever is for a person's report that is still open or being investigated. */
export function canDismissAbusive(report: Pick<AdminReportDetail, 'source' | 'status'>): boolean {
  return report.source === 'user' && (report.status === 'open' || report.status === 'investigating');
}
