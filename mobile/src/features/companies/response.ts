import { useQuery } from '@tanstack/react-query';
import { supabase } from '~/lib/supabase';

/** How a company answers applications (migration 370); null when it has too few to say. */
export type CompanyResponse = { sample: number; openRate: number; medianDays: number | null };

const DAY = 24 * 60 * 60 * 1000;

/**
 * Kept a day per company: it moves slowly, and the listing asks for it on
 * every open. A read that fails, or a company with fewer than five
 * applications, says nothing — the listing then draws no line.
 */
export function useCompanyResponse(companyId: string | null) {
  return useQuery({
    queryKey: ['companies', 'response', companyId],
    enabled: Boolean(companyId),
    staleTime: DAY,
    gcTime: DAY,
    queryFn: async (): Promise<CompanyResponse | null> => {
      const { data, error } = await supabase.rpc('company_response_stats', { p_company_id: companyId as string });
      if (error) return null;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { sample: number; open_rate: number | string; median_days: number | string | null }
        | undefined;
      if (!row) return null;
      return {
        sample: Number(row.sample),
        openRate: Number(row.open_rate),
        medianDays: row.median_days == null ? null : Number(row.median_days),
      };
    },
  });
}
