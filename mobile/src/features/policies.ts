import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentVisibility } from '@/lib/supabase/database.types';
import { useMobileConfig } from '~/features/config';
import { callAction } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * Whether the person has agreed to the Terms of use and the Privacy policy as
 * the website publishes them now — the website's getPolicyStatus, for the
 * phone. The current versions come from /api/mobile/v1/config; the person's
 * agreements from policy_acceptances (migration 336), their own rows under
 * row-level security.
 *
 *   current   agreed to both, as they are now, at some point
 *   outdated  never recorded, or a document changed since
 *   unknown   either side could not be read (an older server, the table not
 *             there yet, offline): nothing is asked, as nothing could be kept
 *
 * Any agreement to the current pair, not the latest one, as on the website:
 * after a release that changed a document is rolled back, somebody who agreed
 * to the earlier pair before would be asked again and could never answer —
 * the website keeps a pair once, so "I agree" recorded nothing new.
 */
export type PolicyStatus = 'current' | 'outdated' | 'unknown';

export function usePolicyStatus(): PolicyStatus {
  const userId = useSession().session?.user.id ?? null;
  const versions = useMobileConfig().data?.policies;
  const agreed = useQuery({
    queryKey: ['policies', 'accepted', userId, versions?.terms, versions?.privacy],
    // Nothing to look for until the website says what is current.
    enabled: Boolean(userId && versions),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('policy_acceptances')
        .select('id')
        .eq('user_id', userId!)
        .eq('terms_version', versions!.terms)
        .eq('privacy_version', versions!.privacy)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data !== null;
    },
  });

  if (!versions || agreed.isError || agreed.isPending) return 'unknown';
  return agreed.data ? 'current' : 'outdated';
}

/** "I agree": recorded by the website, with the versions it publishes. */
export function useAcceptPolicies() {
  const queryClient = useQueryClient();
  const userId = useSession().session?.user.id ?? null;
  return useMutation({
    mutationFn: async () => {
      const result = await callAction('acceptPolicies');
      if (!result.ok) throw new Error(result.error);
    },
    // What the website recorded is the pair it publishes now, which may not be
    // the pair this phone last read: a release that changed a document since
    // left the notice up after "I agree", looking for an agreement to the old
    // dates, until the config's five minutes ran out. Both are read again.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['config'] }),
        queryClient.invalidateQueries({ queryKey: ['policies', 'accepted', userId] }),
      ]),
  });
}

/**
 * The visibility of a candidate's directory card that nobody asked them
 * about: the card was made before onboarding asked (visibility_chosen_at is
 * null, migration 336). Null when they chose, when there is no card, or when
 * it could not be read — a database without the column asks nothing.
 */
export function useUnchosenVisibility(enabled: boolean) {
  const userId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ['profile', 'visibility-choice', userId],
    enabled: enabled && Boolean(userId),
    queryFn: async (): Promise<AgentVisibility | null> => {
      const { data, error } = await supabase
        .from('agent_profiles')
        .select('visibility, visibility_chosen_at')
        .eq('user_id', userId!)
        .maybeSingle();
      if (error || !data) return null;
      return data.visibility_chosen_at === null ? data.visibility : null;
    },
  });
}
