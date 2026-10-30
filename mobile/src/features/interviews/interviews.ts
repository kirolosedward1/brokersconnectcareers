import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InterviewInviteRow, InterviewMode } from '@/lib/supabase/database.types';
import { track } from '~/lib/analytics';
import { callAction } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { cairoDay } from './cairo-time';

/**
 * Interview invitations (migration 373) — reads under row-level security
 * (the company reads its applications', a candidate their own), writes
 * through the website's actions. Times are instants, shown in Cairo time.
 */

/** Still standing: waiting on the candidate, agreed, or waiting on the company. */
export const LIVE_STATUSES = ['proposed', 'accepted', 'counter'] as const;

export class InterviewRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'InterviewRefused';
  }
}

/** The latest invitation per application, cancelled ones left out. */
function latestByApplication(rows: InterviewInviteRow[]): Map<string, InterviewInviteRow> {
  const latest = new Map<string, InterviewInviteRow>();
  for (const row of rows) {
    const known = latest.get(row.application_id);
    if (!known || known.created_at < row.created_at) latest.set(row.application_id, row);
  }
  return latest;
}

/** For the company: the standing invitation of each of these applications. */
export function useInterviewsFor(applicationIds: string[]) {
  const key = [...applicationIds].sort();
  return useQuery({
    queryKey: ['interviews', 'company', key],
    enabled: key.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('interview_invites')
        .select('*')
        .in('application_id', key)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return latestByApplication((data ?? []) as InterviewInviteRow[]);
    },
  });
}

/** For the candidate: their invitations, by application. */
export function useMyInterviews() {
  const { session, actor } = useSession();
  const userId = actor?.profile?.role === 'candidate' ? (session?.user.id ?? null) : null;
  return useQuery({
    queryKey: ['interviews', 'mine', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('interview_invites')
        .select('*')
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return latestByApplication((data ?? []) as InterviewInviteRow[]);
    },
  });
}

export type TodaysInterview = { id: string; starts_at: string; status: string; name: string; jobId: string };

/** For the company's Home: today's interviews, agreed or still waiting, in Cairo's day. */
export function useTodaysInterviews(enabled: boolean, now: number) {
  const day = cairoDay(new Date(now));
  return useQuery({
    queryKey: ['interviews', 'today', day],
    enabled,
    queryFn: async (): Promise<TodaysInterview[]> => {
      // A day either side, narrowed to Cairo's day below: the offset is the time zone database's.
      const from = new Date(now - 36 * 3_600_000).toISOString();
      const to = new Date(now + 36 * 3_600_000).toISOString();
      const { data, error } = await supabase
        .from('interview_invites')
        .select('id, starts_at, status, application:applications ( job_id, candidate:profiles ( full_name ) )')
        .in('status', ['proposed', 'accepted'])
        .gte('starts_at', from)
        .lte('starts_at', to)
        .order('starts_at', { ascending: true });
      if (error) throw error;
      type Row = { id: string; starts_at: string; status: string; application: { job_id: string; candidate: { full_name: string } | null } | null };
      return ((data ?? []) as unknown as Row[])
        .filter((row) => cairoDay(new Date(row.starts_at)) === day)
        .map((row) => ({
          id: row.id,
          starts_at: row.starts_at,
          status: row.status,
          name: row.application?.candidate?.full_name ?? '',
          jobId: row.application?.job_id ?? '',
        }));
    },
  });
}

function refusal(result: { ok: boolean; error?: string }) {
  if (!result.ok) throw new InterviewRefused(result.error ?? 'failed');
}

export type InviteInput = {
  applicationId: string;
  startsAt: string;
  minutes: number;
  mode: InterviewMode;
  place: string | null;
  note: string | null;
};

export function useInterviewActions() {
  const queryClient = useQueryClient();
  const settle = () => {
    void queryClient.invalidateQueries({ queryKey: ['interviews'] });
    // An invitation can move the application to the interview stage.
    void queryClient.invalidateQueries({ queryKey: ['employer', 'applicants'] });
    void queryClient.invalidateQueries({ queryKey: ['applications'] });
  };
  const invite = useMutation({
    mutationFn: async (input: InviteInput) => refusal(await callAction('inviteToInterview', input)),
    onSuccess: () => track('interview_invited', {}),
    onSettled: settle,
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => refusal(await callAction('cancelInterview', { id })),
    onSettled: settle,
  });
  const acceptProposed = useMutation({
    mutationFn: async (id: string) => refusal(await callAction('acceptProposedTime', { id })),
    onSettled: settle,
  });
  const answer = useMutation({
    mutationFn: async (input: { id: string; answer: 'accepted' | 'declined' | 'counter'; counterStartsAt?: string | null }) =>
      refusal(await callAction('answerInterview', input)),
    onSuccess: (_data, input) => track('interview_answered', { answer: input.answer }),
    onSettled: settle,
  });
  return { invite, cancel, acceptProposed, answer };
}
