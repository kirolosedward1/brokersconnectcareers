import { useQuery } from '@tanstack/react-query';
import type { DeveloperRow, DistrictRow, GovernorateRow } from '@/lib/supabase/database.types';
import { supabase } from '~/lib/supabase';

/**
 * The places and developers every filter and card names, read straight from
 * the tables (anyone may read them) and kept for a day — the website caches
 * them for a day too. These are the only queries that survive a restart
 * (see query.ts), so filters draw immediately on a cold start.
 */
const DAY = 24 * 60 * 60 * 1000;

/** Each table in the website's order (src/lib/queries/taxonomy.ts): places by id, developers by name. */
const ORDER = { districts: 'id', governorates: 'id', developers: 'name_en' } as const;

function taxonomy<T>(table: 'districts' | 'governorates' | 'developers') {
  return {
    queryKey: ['taxonomy', table] as const,
    queryFn: async (): Promise<T[]> => {
      const { data, error } = await supabase.from(table).select('*').order(ORDER[table]);
      if (error) throw error;
      return (data ?? []) as T[];
    },
    staleTime: DAY,
    gcTime: DAY,
  };
}

export const useDistricts = () => useQuery(taxonomy<DistrictRow>('districts'));
export const useGovernorates = () => useQuery(taxonomy<GovernorateRow>('governorates'));
export const useDevelopers = () => useQuery(taxonomy<DeveloperRow>('developers'));
