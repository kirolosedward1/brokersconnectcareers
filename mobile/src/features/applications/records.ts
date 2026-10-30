import { useQuery } from '@tanstack/react-query';
import type { ApplicationRecordRow } from '@/lib/supabase/database.types';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * What the candidate keeps of an application a company cleared or took with
 * it when it closed (Phase B 07c, migration 379; decided: candidates keep a
 * record). Their own rows only, under row-level security; kept a year from
 * applying, as the application would have been. A server from before the
 * migration has none to give, and says nothing.
 */
export function useApplicationRecords() {
  const userId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ['applications', 'records', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<ApplicationRecordRow[]> => {
      const { data, error } = await supabase
        .from('application_records')
        .select('*')
        .order('applied_at', { ascending: false })
        .limit(100);
      if (error) return [];
      return (data ?? []) as ApplicationRecordRow[];
    },
  });
}
