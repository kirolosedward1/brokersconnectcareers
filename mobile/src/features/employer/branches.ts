import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CompanyBranchRow } from '@/lib/supabase/database.types';
import { callAction } from '~/lib/api';
import { supabase } from '~/lib/supabase';

/**
 * A company's branches (Phase B 07b, migration 383): a name and a district
 * each, read by everyone, kept by the company's admins. A server from before
 * the migration has none, and nothing is drawn for them.
 */
export type Branch = CompanyBranchRow & { district: { name_ar: string; name_en: string } | null };

export const MAX_BRANCHES = 20;

export function useBranches(companyId: string | null) {
  return useQuery({
    queryKey: ['companies', 'branches', companyId],
    enabled: Boolean(companyId),
    queryFn: async (): Promise<Branch[] | null> => {
      const { data, error } = await supabase
        .from('company_branches')
        .select('*, district:districts (name_ar, name_en)')
        .eq('company_id', companyId as string)
        .order('created_at', { ascending: true });
      if (error) return null;
      return (data ?? []) as unknown as Branch[];
    },
  });
}

export class BranchRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'BranchRefused';
  }
}

export function useSaveBranch(companyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: number; nameAr: string; nameEn?: string | null; districtId: number | null }) => {
      const result = await callAction('saveBranch', input);
      if (!result.ok) throw new BranchRefused(result.error);
      return result.data?.id ?? null;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['companies', 'branches', companyId] }),
  });
}

export function useDeleteBranch(companyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const result = await callAction('deleteBranch', { id });
      if (!result.ok) throw new BranchRefused(result.error);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['companies', 'branches', companyId] }),
  });
}
