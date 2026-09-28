import { useQuery } from '@tanstack/react-query';
import { supabase } from '~/lib/supabase';
import { useSession } from '~/lib/session';

/**
 * Which listings on screen this reader has already applied to — the board's
 * "applied" badge.
 *
 * The website's two small reads keyed to the ids on the page, not a join on
 * the listing query: the board is public and cached, and a per-reader column
 * in it would make every result set personal. Scoped to the reader explicitly,
 * with row-level security still behind it. Skipped for anyone who is not a
 * candidate, who has no answer to give.
 */
export function useAppliedJobIds(jobIds: string[]): Set<string> {
  const { viewer } = useSession();
  const candidateId = viewer?.profile?.role === 'candidate' ? viewer.userId : null;

  const { data } = useQuery({
    queryKey: ['jobs', 'applied', candidateId, jobIds],
    enabled: Boolean(candidateId) && jobIds.length > 0,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('applications')
        .select('job_id')
        .eq('candidate_id', candidateId as string)
        .in('job_id', jobIds);
      if (error) throw error;
      return new Set((rows ?? []).map((row) => row.job_id as string));
    },
    staleTime: 30_000,
  });

  return data ?? EMPTY;
}

const EMPTY = new Set<string>();
