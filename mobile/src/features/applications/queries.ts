import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { canAccessCandidateArea } from '@/lib/permissions';
import type { ApplicationStatus, JobStatus } from '@/lib/supabase/database.types';
import { callAction } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/** The badge each status wears, as on the website's dashboard and applications page. */
export const STATUS_VARIANT: Record<ApplicationStatus, 'default' | 'primary' | 'success' | 'destructive'> = {
  new: 'default',
  shortlisted: 'primary',
  interview: 'primary',
  hired: 'success',
  rejected: 'destructive',
};

/** Withdrawing is offered only while the outcome is still open. */
export function canWithdraw(status: ApplicationStatus): boolean {
  return status === 'new' || status === 'shortlisted';
}

export type CandidateApplication = {
  id: string;
  job_id: string;
  status: ApplicationStatus;
  created_at: string;
  decision_note: string | null;
  employer_viewed_at: string | null;
  job: {
    slug: string;
    status: JobStatus;
    expires_at: string | null;
    title_ar: string;
    title_en: string | null;
    company: { name_ar: string; name_en: string | null; slug: string };
    district: { name_ar: string; name_en: string };
  } | null;
};

/**
 * Every application this candidate has made, newest first — the website's
 * /dashboard/applications read, column for column (and the job's id, which
 * the Home tab's suggestions leave out). Scoped to the candidate
 * explicitly, with row-level security still behind it: the policies alone are
 * an OR no index can serve.
 */
export function useMyApplications() {
  const { session, actor } = useSession();
  const candidateId = canAccessCandidateArea(actor) ? (session?.user.id ?? null) : null;

  return useQuery({
    queryKey: ['applications', candidateId],
    enabled: Boolean(candidateId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('applications')
        .select(
          `
          id, job_id, status, created_at, decision_note, employer_viewed_at,
          job:jobs (
            slug, status, expires_at, title_ar, title_en,
            company:companies (name_ar, name_en, slug),
            district:districts (name_ar, name_en)
          )
        `,
        )
        .eq('candidate_id', candidateId as string)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CandidateApplication[];
    },
  });
}

/**
 * Take an application back — the website's withdrawApplication, which says
 * truthfully whether it happened. It cannot be undone: the listing will not
 * take a second application from the same person.
 */
export function useWithdrawApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (applicationId: string) => {
      const result = await callAction('withdrawApplication', { applicationId });
      if (!result.ok) throw new Error(result.error);
      return applicationId;
    },
    // Read again whatever the answer: a refusal usually means the company
    // moved the application on meanwhile (no longer withdrawable), and a lost
    // answer may hide a withdrawal that went in — either way the row on
    // screen was wrong, and stayed so with its Withdraw button.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      // The board's "applied" badges and the dashboard's counts.
      queryClient.invalidateQueries({ queryKey: ['jobs', 'applied'] });
      queryClient.invalidateQueries({ queryKey: ['candidate'] });
      // The listing's apply page: the row is gone, and so is "applied already".
      queryClient.invalidateQueries({ queryKey: ['apply'] });
    },
  });
}
