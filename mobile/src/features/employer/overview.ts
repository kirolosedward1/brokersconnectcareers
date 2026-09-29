import { useQuery } from '@tanstack/react-query';
import { canAccessEmployerArea } from '@/lib/permissions';
import type { EmployerSummary, EmployerTrend } from '@/lib/supabase/database.types';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * The employer's overview — the website's /employer, which is the Home tab in
 * the app. Both reads are the database's own summaries, scoped to the
 * viewer's company by `my_company_id()`; null when they cannot be had, and
 * the page then says only what it knows.
 */

function useEmployerId(): string | null {
  const { session, actor } = useSession();
  return canAccessEmployerArea(actor) ? (session?.user.id ?? null) : null;
}

/** employer_summary(): the figures, the next action and the setup checklist all read this. */
export function useEmployerSummary() {
  const userId = useEmployerId();
  return useQuery({
    queryKey: ['employer', 'summary', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('employer_summary');
      return error ? null : ((data as EmployerSummary | null) ?? null);
    },
  });
}

/** employer_trend(): thirty days of applications on the Cairo calendar, and how each live listing converts. */
export function useEmployerTrend() {
  const userId = useEmployerId();
  return useQuery({
    queryKey: ['employer', 'trend', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('employer_trend');
      return error ? null : ((data as EmployerTrend | null) ?? null);
    },
  });
}

/**
 * The reason a moderator gave for suspending the company — readable by its
 * members (migration 327). Null when there is none or it cannot be read.
 */
export function useCompanySuspension(companyId: string | null, suspended: boolean) {
  return useQuery({
    queryKey: ['employer', 'suspension', companyId],
    enabled: Boolean(companyId) && suspended,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_moderation')
        .select('suspension_reason')
        .eq('company_id', companyId as string)
        .maybeSingle();
      return error ? null : ((data?.suspension_reason as string | null | undefined) ?? null);
    },
  });
}
