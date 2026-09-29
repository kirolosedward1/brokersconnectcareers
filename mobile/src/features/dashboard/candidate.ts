import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { JobListItem } from '@/lib/job-list';
import { rankJobs, type MatchReasons } from '@/lib/match';
import type { NextActionKind } from '@/lib/next-action';
import type { CandidateSummary } from '@/lib/supabase/database.types';
import { useMyApplications } from '~/features/applications/queries';
import { useJobBoard } from '~/features/jobs/queries';
import { useHiddenCompanies, withoutHidden } from '~/features/moderation/hidden-companies';
import { useAgentProfile } from '~/features/profile/queries';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * The candidate's overview — the website's /dashboard, which is the Home tab
 * in the app: the figures, the one thing worth doing, where the applications
 * stand and what to look at next.
 */

/** Where the completeness figure starts to warn, and the profile becomes the next action. */
export const COMPLETENESS_WARN = 60;

export type CandidateNextAction = {
  kind: Extract<NextActionKind, 'replies' | 'profile'>;
  tone: 'good' | 'attention';
  href: '/dashboard/applications' | '/account/profile';
};

/**
 * The one next action, by the website's rule: an ordered list, first true
 * wins. A reply is somebody else moving; an incomplete profile is what decides
 * whether a verified company can find them at all. Nothing when nothing needs
 * doing — and nothing when the figures could not be read.
 */
export function candidateNextAction(summary: CandidateSummary | null): CandidateNextAction | null {
  if (!summary) return null;
  if (summary.replies > 0) return { kind: 'replies', tone: 'good', href: '/dashboard/applications' };
  if (summary.profile_completeness < COMPLETENESS_WARN) return { kind: 'profile', tone: 'attention', href: '/account/profile' };
  return null;
}

/**
 * The note a moderator left on this account (my_account_note, migration 328)
 * — asked only while the account is not in good standing, and null when it
 * cannot be read, in which case the notice simply gives no reason.
 */
export function useAccountNote(enabled: boolean) {
  const userId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ['account', 'note', userId],
    enabled: enabled && Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_account_note');
      return error ? null : ((data as string | null) ?? null);
    },
  });
}

export type Suggestion = { job: JobListItem; score: number; reasons: MatchReasons };

/**
 * Roles worth a look: the board's first page, without anything already applied
 * to (the applications sit right above) or from a company this reader hid,
 * ranked against their own stated tracks, districts and years by the website's
 * rankJobs. Three of them.
 *
 * Drawn once the applications and the profile have been read, not before: a
 * role suggested and then taken away as the applications arrive is a list
 * rearranging itself under a thumb. `personalised` is false when the profile
 * names no track and no district — the order is then simply the newest, and
 * the page says so rather than calling it a recommendation.
 */
export function useSuggestions() {
  const board = useJobBoard('');
  const applications = useMyApplications();
  const profile = useAgentProfile();
  const hidden = useHiddenCompanies();

  const firstPage = board.data?.pages[0]?.jobs;
  const settled = Boolean(firstPage) && !applications.isPending && !profile.isPending;
  const agent = profile.data?.agent ?? null;

  const ranking = useMemo(() => {
    if (!settled || !firstPage) return null;
    // A failed read of the applications suggests from the whole page, as the website does.
    const appliedTo = new Set((applications.data ?? []).map((application) => application.job_id));
    return rankJobs(
      withoutHidden(firstPage, hidden).filter((job) => !appliedTo.has(job.id)),
      {
        tracks: agent?.tracks ?? null,
        districtIds: agent?.district_ids ?? null,
        yearsExperience: agent?.years_experience ?? null,
      },
    );
  }, [settled, firstPage, applications.data, hidden, agent]);

  return {
    suggestions: (ranking?.ranked.slice(0, 3) ?? []) as Suggestion[],
    personalised: ranking?.personalised ?? false,
    /** Only a profile that was read can be said to be missing a track: a failed read offers no fix. */
    profileKnown: profile.isSuccess,
    board,
  };
}
