import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { callAction } from '~/lib/api';
import { supabase } from '~/lib/supabase';

/**
 * Who owns the company, and when it goes (Phase B 07c, migration 379):
 * hand it to a member, ask for it to be deleted (hidden at once, gone after
 * 14 days) or change one's mind, and how long the applications to an ended
 * listing are kept. Read off the company row; a server from before the
 * migration has none of it, and the card is not drawn.
 */
export type CompanyClosure = {
  deletionRequestedAt: string | null;
  closedAt: string | null;
  purgeAfterDays: 30 | 90 | 180 | 365 | null;
};

export const PURGE_CHOICES = [null, 365, 180, 90, 30] as const;

/** The day a closing company goes: 14 days after its owner asked. */
export const CLOSURE_DAYS = 14;

export function useCompanyClosure(companyId: string | null) {
  return useQuery({
    queryKey: ['employer', 'closure', companyId],
    enabled: Boolean(companyId),
    queryFn: async (): Promise<CompanyClosure | null> => {
      const { data, error } = await supabase
        .from('companies')
        .select('deletion_requested_at, closed_at, purge_closed_after_days')
        .eq('id', companyId as string)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as { deletion_requested_at?: string | null; closed_at?: string | null; purge_closed_after_days?: CompanyClosure['purgeAfterDays'] };
      if (row.deletion_requested_at === undefined) return null;
      return {
        deletionRequestedAt: row.deletion_requested_at ?? null,
        closedAt: row.closed_at ?? null,
        purgeAfterDays: row.purge_closed_after_days ?? null,
      };
    },
  });
}

export class ClosureRefused extends Error {
  constructor(
    readonly reason: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(reason);
    this.name = 'ClosureRefused';
  }
}

function useCompanyAction<I>(name: 'transferCompanyOwnership' | 'requestCompanyDeletion' | 'cancelCompanyDeletion' | 'setApplicationPurge') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: I) => {
      const result = await callAction(name, input as never);
      if (!result.ok) throw new ClosureRefused(result.error, result.fieldErrors);
    },
    // The roster, the owner's controls, the public notices and who the viewer is all move.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['employer'] });
      void queryClient.invalidateQueries({ queryKey: ['companies'] });
      void queryClient.invalidateQueries({ queryKey: ['viewer'] });
    },
  });
}

export const useTransferOwnership = () => useCompanyAction<{ userId: string }>('transferCompanyOwnership');
export const useRequestDeletion = () => useCompanyAction<{ confirmName: string }>('requestCompanyDeletion');
export const useCancelDeletion = () => useCompanyAction<Record<string, never>>('cancelCompanyDeletion');
export const useSetPurge = () => useCompanyAction<{ days: CompanyClosure['purgeAfterDays'] }>('setApplicationPurge');
