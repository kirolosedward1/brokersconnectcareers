import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApplicationStatus } from '@/lib/supabase/database.types';
import { callAction } from '~/lib/api';
import { useRetryKey } from '~/lib/retry-key';

/**
 * Several applicants at once (Phase B 01): moved — each as a single move,
 * compared on the stage its card showed — or written to by email. The
 * website does each one as it does one; the counts come back.
 */

export class BulkRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'BulkRefused';
  }
}

/** The reasons a company may give for turning applicants down (decided list). */
export const DECLINE_REASONS = ['experience', 'area', 'track', 'filled', 'other'] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export function useBulkMove() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      items: { applicationId: string; from: ApplicationStatus }[];
      status: ApplicationStatus;
      decisionNote?: string | null;
      shareReason?: boolean;
    }) => {
      const result = await callAction('setApplicationStatuses', {
        items: input.items,
        status: input.status,
        decisionNote: input.decisionNote?.trim() || null,
        ...(input.shareReason === false ? { shareReason: false } : {}),
      });
      if (!result.ok) throw new BulkRefused(result.error);
      return result.data ?? { moved: 0, movedAlready: 0, failed: 0, reasonsNotKept: 0 };
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['employer'] });
      void queryClient.invalidateQueries({ queryKey: ['interviews'] });
    },
  });
}

export function useMessageApplicants() {
  const retryKey = useRetryKey();
  return useMutation({
    mutationFn: async (input: { applicationIds: string[]; message: string }) => {
      // The same message sent again after a lost answer is the same send.
      const key = retryKey.for(input);
      const result = await callAction('messageApplicants', { ...input, key });
      if (!result.ok) throw new BulkRefused(result.error);
      retryKey.done();
      return result.data ?? { sent: 0, skipped: 0 };
    },
  });
}
