import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { canAccessCandidateArea } from '@/lib/permissions';
import type { ApplicationStatus, JobStatus } from '@/lib/supabase/database.types';
import { callAction } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

export type CandidateApplication = {
  id: string;
  job_id: string;
  status: ApplicationStatus;
  created_at: string;
  decision_note: string | null;
  employer_viewed_at: string | null;
  /** How it moved, as the candidate may read it (application_events, migration 42); absent from older reads. */
  events?: { from_status: ApplicationStatus | null; to_status: ApplicationStatus; created_at: string }[] | null;
  job: {
    slug: string;
    status: JobStatus;
    expires_at: string | null;
    title_ar: string;
    title_en: string | null;
    company: { id?: string; name_ar: string; name_en: string | null; slug: string };
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
          events:application_events (from_status, to_status, created_at),
          job:jobs (
            slug, status, expires_at, title_ar, title_en,
            company:companies (id, name_ar, name_en, slug),
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
 * truthfully whether it happened. The row stays, marked withdrawn. While the
 * listing is open, the same person can apply again; that is a new row.
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
      // The listing's apply page: a withdrawn application is not "applied already".
      queryClient.invalidateQueries({ queryKey: ['apply'] });
    },
  });
}

/** When the application last moved from one stage to another; null while it has not. */
export function lastMovedAt(application: Pick<CandidateApplication, 'events'>): string | null {
  let last: string | null = null;
  for (const event of application.events ?? []) {
    if (!event.from_status) continue;
    if (!last || new Date(event.created_at).getTime() > new Date(last).getTime()) last = event.created_at;
  }
  return last;
}

/** Days without an answer after which the list offers to withdraw (v1.1). */
export const QUIET_DAYS = 7;

/**
 * Whole days an application has waited at «new» without a move — null once
 * it has moved, or when it is not waiting at all.
 */
export function daysWithoutAnswer(application: Pick<CandidateApplication, 'status' | 'created_at' | 'events'>, now = Date.now()): number | null {
  if (application.status !== 'new' || lastMovedAt(application)) return null;
  return Math.floor((now - new Date(application.created_at).getTime()) / (24 * 60 * 60 * 1000));
}
