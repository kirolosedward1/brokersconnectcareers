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
 * latest agreement from policy_acceptances (migration 336), their own rows
 * under row-level security.
 *
 *   current   agreed to both, as they are now
 *   outdated  never recorded, or a document changed since
 *   unknown   either side could not be read (an older server, the table not
 *             there yet, offline): nothing is asked, as nothing could be kept
 */
export type PolicyStatus = 'current' | 'outdated' | 'unknown';

export function usePolicyStatus(): PolicyStatus {
  const userId = useSession().session?.user.id ?? null;
  const versions = useMobileConfig().data?.policies;
  const latest = useQuery({
    queryKey: ['policies', 'accepted', userId],
    // Nothing to compare with until the website says what is current.
    enabled: Boolean(userId && versions),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('policy_acceptances')
        .select('terms_version, privacy_version')
        .eq('user_id', userId!)
        .order('accepted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (!versions || latest.isError || latest.isPending) return 'unknown';
  const row = latest.data;
  return row && row.terms_version === versions.terms && row.privacy_version === versions.privacy ? 'current' : 'outdated';
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['policies', 'accepted', userId] }),
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
