import { useQuery } from '@tanstack/react-query';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * Who revealed a number (Phase B 10, migration 381), over the 90 days the
 * ledger keeps. A server from before the migration answers nothing, and the
 * screens draw what they drew before.
 */

/** When the viewer's company last revealed this consultant, or null: «كشف سابق». */
export function useCompanyRevealed(handle: string, enabled: boolean) {
  return useQuery({
    queryKey: ['directory', 'revealed', handle],
    enabled,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.rpc('my_company_revealed', { p_handle: handle });
      if (error) return null;
      return (data as string | null) ?? null;
    },
  });
}

export type RevealEntry = { revealedAt: string; companyNameAr: string | null; companyNameEn: string | null; companySlug: string | null };

/** The consultant's own log: which companies revealed their number, newest first. */
export function useMyRevealLog(enabled: boolean) {
  const userId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ['directory', 'reveal-log', userId],
    enabled: enabled && Boolean(userId),
    queryFn: async (): Promise<RevealEntry[] | null> => {
      const { data, error } = await supabase.rpc('my_contact_reveals', { p_limit: 100 });
      if (error) return null;
      return ((data ?? []) as { revealed_at: string; company_name_ar: string | null; company_name_en: string | null; company_slug: string | null }[]).map(
        (row) => ({ revealedAt: row.revealed_at, companyNameAr: row.company_name_ar, companyNameEn: row.company_name_en, companySlug: row.company_slug }),
      );
    },
  });
}
