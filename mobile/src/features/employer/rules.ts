import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApprovalRequestRow, ApplicationStatus } from '@/lib/supabase/database.types';
import { callAction } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * The rules a company sets for its own team (Phase B 05, migration 380), and
 * the declines and pay changes that wait for an admin because of them. A
 * server from before the migration has no rules: every one reads as off.
 */
export type CompanyRules = {
  approveDecline: boolean;
  approvePayChange: boolean;
  spendCeilingMonthEgp: number | null;
  requireMfa: boolean;
  cvAdminsOnly: boolean;
  /** The second factor the company requires is met by this session (or none is required). */
  mfaSatisfied: boolean;
};

export function useCompanyRules() {
  const { session } = useSession();
  return useQuery({
    // Keyed by the session's token: verifying a second factor lifts it to aal2, and the answer changes.
    queryKey: ['employer', 'rules', session?.access_token ?? null],
    enabled: Boolean(session),
    queryFn: async (): Promise<CompanyRules | null> => {
      const { data, error } = await supabase.rpc('company_rules');
      if (error) return null;
      const row = (Array.isArray(data) ? data[0] : data) as
        | {
            approve_decline: boolean;
            approve_pay_change: boolean;
            spend_ceiling_month_egp: number | null;
            require_mfa: boolean;
            cv_admins_only: boolean;
            mfa_satisfied: boolean;
          }
        | undefined;
      if (!row) return null;
      return {
        approveDecline: row.approve_decline,
        approvePayChange: row.approve_pay_change,
        spendCeilingMonthEgp: row.spend_ceiling_month_egp,
        requireMfa: row.require_mfa,
        cvAdminsOnly: row.cv_admins_only,
        mfaSatisfied: row.mfa_satisfied,
      };
    },
  });
}

export class RulesRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'RulesRefused';
  }
}

export function useSaveRules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<CompanyRules, 'mfaSatisfied'>) => {
      const result = await callAction('saveCompanyRules', input);
      if (!result.ok) throw new RulesRefused(result.error);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['employer', 'rules'] }),
  });
}

/** A request, with what it is about read for the admin deciding it. */
export type ApprovalRequest = ApprovalRequestRow & {
  candidateName: string | null;
  jobTitleAr: string | null;
  jobTitleEn: string | null;
  /** A decline: the stage the applicant is at now (a colleague may have moved them since). */
  currentStatus: ApplicationStatus | null;
};

/**
 * What waits: every pending request of the company for an admin, and the
 * reader's own asks (any status) for anybody — the policy decides which.
 */
export function useApprovalRequests() {
  const userId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ['employer', 'approvals', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<ApprovalRequest[]> => {
      const { data, error } = await supabase
        .from('company_approval_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) {
        // A server from before the migration has no queue.
        if (error.code === '42P01' || error.code === 'PGRST205') return [];
        throw error;
      }
      const rows = (data ?? []) as ApprovalRequestRow[];
      const declines = rows.filter((row) => row.kind === 'decline').map((row) => row.subject_id);
      const listings = rows.filter((row) => row.kind === 'pay_change').map((row) => row.subject_id);
      const [apps, jobs] = await Promise.all([
        declines.length
          ? supabase.from('applications').select('id, status, candidate:profiles (full_name), job:jobs (title_ar, title_en)').in('id', declines)
          : Promise.resolve({ data: [] }),
        listings.length ? supabase.from('jobs').select('id, title_ar, title_en').in('id', listings) : Promise.resolve({ data: [] }),
      ]);
      const appById = new Map(
        ((apps.data ?? []) as unknown as {
          id: string;
          status: ApplicationStatus;
          candidate: { full_name: string } | null;
          job: { title_ar: string; title_en: string | null } | null;
        }[]).map((row) => [row.id, row]),
      );
      const jobById = new Map(((jobs.data ?? []) as { id: string; title_ar: string; title_en: string | null }[]).map((row) => [row.id, row]));
      return rows.map((row) => {
        const app = appById.get(row.subject_id);
        const job = row.kind === 'decline' ? app?.job : jobById.get(row.subject_id);
        return {
          ...row,
          candidateName: app?.candidate?.full_name ?? null,
          jobTitleAr: job?.title_ar ?? null,
          jobTitleEn: job?.title_en ?? null,
          currentStatus: app?.status ?? null,
        };
      });
    },
  });
}

export function useDecideRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; approve: boolean; note?: string | null }) => {
      const result = await callAction('decideApprovalRequest', input);
      if (!result.ok) throw new RulesRefused(result.error);
      return result.data?.outcome ?? (input.approve ? 'approved' : 'refused');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['employer'] });
    },
  });
}
