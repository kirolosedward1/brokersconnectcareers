import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppealRefusal } from '@/lib/mobile-api/contract';
import type { AppealState, AppealSubjectType } from '@/lib/supabase/database.types';
import { callAction } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * Asking for a moderator's decision to be looked at again — the website's
 * appeal panel. Whether this person may appeal, and what they already asked,
 * is the database's answer (my_appeal_state, migration 328); null when it
 * cannot be had — a database without that migration, a failed read — and the
 * panel then offers nothing, the honest thing when appealing is not possible.
 */
export function useAppealState(subjectType: AppealSubjectType, subjectId: string | null) {
  const userId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ['appeal', subjectType, subjectId, userId],
    enabled: Boolean(subjectId && userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_appeal_state', {
        p_subject_type: subjectType,
        p_subject_id: subjectId as string,
      });
      return error || !data ? null : (data as AppealState);
    },
  });
}

/** The refusal as a code the panel has words for; anything else is 'failed'. */
export class AppealRefused extends Error {
  constructor(readonly reason: AppealRefusal | 'failed') {
    super(reason);
    this.name = 'AppealRefused';
  }
}

const REFUSALS: readonly AppealRefusal[] = [
  'message_required',
  'not_appealable',
  'appeal_open',
  'appeal_limit',
  'appeal_too_soon',
  'rate_limit',
  'company_suspended',
  'unavailable',
];

export function useSubmitAppeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { subjectType: AppealSubjectType; subjectId: string; message: string }) => {
      const result = await callAction('submitAppeal', input);
      if (!result.ok) {
        throw new AppealRefused((REFUSALS as readonly string[]).includes(result.error) ? (result.error as AppealRefusal) : 'failed');
      }
    },
    // An appeal already waiting is news too: the panel should show it.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['appeal'] }),
  });
}
