import { createClient } from '@/lib/supabase/server';
import { raise } from './error';
import type { CompanyRow, DistrictRow, VerificationStatus } from '@/lib/supabase/database.types';

export const COMPANIES_PER_PAGE = 24;

export type CompanyListItem = CompanyRow & {
  district: DistrictRow | null;
  open_roles: { count: number }[];
};

export async function queryCompanies({
  q,
  verifiedOnly,
  districtId,
  page = 1,
}: {
  q?: string;
  verifiedOnly?: boolean;
  districtId?: number;
  page?: number;
}): Promise<{ companies: CompanyListItem[]; total: number; pageCount: number }> {
  const supabase = await createClient();

  let query = supabase
    .from('companies')
    .select(
      `
      *,
      district:districts (id, governorate_id, name_ar, name_en, slug),
      open_roles:jobs!inner (count)
    `,
      { count: 'exact' },
    )
    // !inner on the jobs relation means only companies with at least one live
    // listing appear — an employer directory full of empty profiles is noise.
    .eq('jobs.status', 'active');

  if (q) query = query.or(`name_ar.ilike.%${q}%,name_en.ilike.%${q}%`);
  if (verifiedOnly) query = query.eq('verification_status', 'verified');
  if (districtId) query = query.eq('district_id', districtId);

  const from = (page - 1) * COMPANIES_PER_PAGE;
  const { data, error, count } = await query
    .order('verification_status', { ascending: true })
    .order('name_ar')
    .range(from, from + COMPANIES_PER_PAGE - 1);

  if (error) raise(error, 'listing companies');

  const total = count ?? 0;
  return {
    companies: (data ?? []) as unknown as CompanyListItem[],
    total,
    pageCount: Math.max(1, Math.ceil(total / COMPANIES_PER_PAGE)),
  };
}

export type CompanyProfile = CompanyRow & { district: DistrictRow | null };

export async function getCompanyBySlug(slug: string): Promise<CompanyProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('companies')
    .select('*, district:districts (id, governorate_id, name_ar, name_en, slug)')
    .eq('slug', slug)
    .maybeSingle();

  if (error) raise(error, 'loading a company');
  return (data as unknown as CompanyProfile) ?? null;
}

export function isVerified(status: VerificationStatus): boolean {
  return status === 'verified';
}
