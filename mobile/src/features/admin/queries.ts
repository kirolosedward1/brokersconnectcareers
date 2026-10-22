import { useQuery } from '@tanstack/react-query';
import { listingNotes, noteFor } from '@/lib/listing-notes';
import { isAdmin } from '@/lib/permissions';
import type {
  AdminOverview,
  AdminReportCase,
  AdminReportDetail,
  AdminUserSearchRow,
  ApprovalStatus,
  CompanyDocumentRow,
  JobRow,
  ReportReason,
  ReportStatus,
  SafetyFlag,
  VerificationStatus,
} from '@/lib/supabase/database.types';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { useAdminDoor } from './door';

/**
 * The admin console's reads, as the website's /admin pages make them — the
 * same tables and the same admin_* functions, under the admin's own session.
 * Nothing here is the authorisation: every row policy and every function
 * answers an admin only (is_admin(), which also wants this session's code
 * from an admin who has an authenticator), and anybody else gets nothing.
 *
 * Each read waits for the admin door (door.ts), so a session the console
 * would not open for never asks. A failed read throws: "nothing waiting" is
 * the answer a moderator acts on by going away, so a read that failed must
 * never be able to say it (the website's must()).
 *
 * Keyed under ['admin'], which every lever invalidates (levers.ts), and never
 * kept for the next start (query.ts keeps only the public reads).
 */

/** The page each queue reads: enough to work through on a phone; the website pages the rest. */
export const QUEUE_SIZE = 50;

function useOpen() {
  const { actor } = useSession();
  const door = useAdminDoor();
  return isAdmin(actor) && door.state === 'open';
}

/** admin_overview: every count the console's first screen shows, in one round trip. */
export function useAdminOverview() {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'overview'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_overview');
      if (error) throw error;
      return data as AdminOverview;
    },
  });
}

/** The things waiting on a person, as the overview's first row adds them up — the tab's badge. */
export function waitingCount(overview: AdminOverview | undefined): number {
  if (!overview) return 0;
  return overview.jobs.pending + overview.reports.open_targets + overview.companies.pending + overview.accounts.pending;
}

export type QueueListing = Pick<JobRow, 'id' | 'slug' | 'title_ar' | 'title_en' | 'status' | 'created_at' | 'version'> & {
  company: {
    id: string;
    name_ar: string;
    name_en: string | null;
    verification_status: VerificationStatus;
    suspended_at: string | null;
  };
  flags: SafetyFlag[];
};

/** The review queue: listings waiting for a decision, oldest first (the website's /admin/jobs). */
export function usePendingListings() {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'listings', 'pending'],
    enabled: open,
    queryFn: async (): Promise<{ rows: QueueListing[]; total: number }> => {
      const { data, error, count } = await supabase
        .from('jobs')
        .select(
          'id, slug, title_ar, title_en, status, created_at, version, company:companies!inner (id, name_ar, name_en, verification_status, suspended_at)',
          { count: 'exact' },
        )
        .eq('status', 'pending_review')
        .order('created_at', { ascending: true })
        .order('id')
        .range(0, QUEUE_SIZE - 1);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Omit<QueueListing, 'flags'>[];
      // What each listing says that deserves a second look (migration 327).
      const flags = new Map<string, SafetyFlag[]>();
      if (rows.length) {
        const signals = await supabase.rpc('admin_job_signals', { p_jobs: rows.map((row) => row.id) });
        if (signals.error) throw signals.error;
        for (const row of signals.data ?? []) flags.set(row.job_id, row.flags);
      }
      return { rows: rows.map((row) => ({ ...row, flags: flags.get(row.id) ?? [] })), total: count ?? rows.length };
    },
  });
}

export type AdminListing = JobRow & {
  company: {
    id: string;
    name_ar: string;
    name_en: string | null;
    slug: string;
    verification_status: VerificationStatus;
    suspended_at: string | null;
  };
  district: { name_ar: string; name_en: string } | null;
  rejection_note: string | null;
  flags: SafetyFlag[];
  reports: { id: string; reason: ReportReason; detail: string | null; status: ReportStatus; created_at: string }[];
};

/** One listing as the moderator decides on it: every text a reader is shown, its flags and its reports. */
export function useAdminListing(id: string | undefined) {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'listing', id],
    enabled: open && Boolean(id),
    queryFn: async (): Promise<AdminListing | null> => {
      const { data, error } = await supabase
        .from('jobs')
        .select(
          '*, company:companies (id, name_ar, name_en, slug, verification_status, suspended_at), district:districts (name_ar, name_en)',
        )
        .eq('id', id as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const job = data as unknown as Omit<AdminListing, 'flags' | 'reports'>;

      const [moderation, signals, reports] = await Promise.all([
        listingNotes(
          (ids) => supabase.from('job_moderation').select('job_id, rejection_note').in('job_id', ids),
          [job.id],
        ),
        supabase.rpc('admin_job_signals', { p_jobs: [job.id] }),
        supabase
          .from('reports')
          .select('id, reason, detail, status, created_at')
          .eq('job_id', job.id)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);
      if (moderation.error) throw moderation.error;
      if (signals.error) throw signals.error;
      if (reports.error) throw reports.error;
      return {
        ...job,
        rejection_note: noteFor(moderation.notes, job),
        flags: signals.data?.[0]?.flags ?? [],
        reports: (reports.data ?? []) as AdminListing['reports'],
      };
    },
  });
}

export type ReportCase = AdminReportCase & { details: AdminReportDetail[] };

/** The two queues of open cases, as the website's /admin/reports has them: new, and under investigation. */
export type ReportView = 'new' | 'under_review';

/** How many of a case's reports are drawn under it, and so read; the website has them all. */
export const SHOWN_REPORTS = 3;

/**
 * Open reports, one case per target, most serious first (admin_report_cases,
 * the website's /admin/reports). A case whose reports are all under
 * investigation leaves the new queue for the under-review one, where its
 * levers still are. Only the reports drawn are read: admin_report_rows takes
 * at most 500 ids, and a viral listing alone can collect that many.
 */
export function useReportCases(view: ReportView) {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'reports', view],
    enabled: open,
    queryFn: async (): Promise<{ cases: ReportCase[]; total: number }> => {
      const { data, error } = await supabase.rpc('admin_report_cases', {
        p_view: view,
        p_limit: QUEUE_SIZE,
        p_offset: 0,
      });
      if (error) throw error;
      const cases = data ?? [];
      const ids = cases.flatMap((item) => item.report_ids.slice(0, SHOWN_REPORTS));
      const byId = new Map<string, AdminReportDetail>();
      if (ids.length) {
        const details = await supabase.rpc('admin_report_rows', { p_ids: ids });
        if (details.error) throw details.error;
        for (const row of details.data ?? []) byId.set(row.id, row);
      }
      return {
        cases: cases.map((item) => ({
          ...item,
          details: item.report_ids.map((reportId) => byId.get(reportId)).filter((row): row is AdminReportDetail => Boolean(row)),
        })),
        total: Number(cases[0]?.total_count ?? 0),
      };
    },
  });
}

/** Accounts by standing (admin_search_users): waiting for approval, or suspended. No phone, no email. */
export function useAccounts(status: Extract<ApprovalStatus, 'pending' | 'rejected'>) {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'accounts', status],
    enabled: open,
    queryFn: async (): Promise<{ rows: AdminUserSearchRow[]; total: number }> => {
      const { data, error } = await supabase.rpc('admin_search_users', {
        p_query: null,
        p_role: null,
        p_status: status,
        p_limit: QUEUE_SIZE,
        p_offset: 0,
      });
      if (error) throw error;
      const rows = data ?? [];
      return { rows, total: Number(rows[0]?.total_count ?? 0) };
    },
  });
}

export type QueueCompany = {
  id: string;
  name_ar: string;
  name_en: string | null;
  slug: string;
  verification_status: VerificationStatus;
  suspended_at: string | null;
  created_at: string;
  version: number;
  company_documents: Pick<CompanyDocumentRow, 'id' | 'doc_type' | 'status' | 'created_at'>[];
};

/** Companies whose papers are waiting to be looked at, oldest first (the website's /admin/companies). */
export function usePendingCompanies() {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'companies', 'pending'],
    enabled: open,
    queryFn: async (): Promise<{ rows: QueueCompany[]; total: number }> => {
      const { data, error, count } = await supabase
        .from('companies')
        .select(
          'id, name_ar, name_en, slug, verification_status, suspended_at, created_at, version, company_documents!inner (id, doc_type, status, created_at)',
          { count: 'exact' },
        )
        .eq('verification_status', 'pending')
        .eq('company_documents.status', 'pending')
        .order('created_at', { ascending: true })
        .order('id')
        .range(0, QUEUE_SIZE - 1);
      if (error) throw error;
      const rows = (data ?? []) as unknown as QueueCompany[];
      return { rows, total: count ?? rows.length };
    },
  });
}
