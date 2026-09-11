import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { raise } from './error';
import { likeNeedle } from '@/lib/search/needle';
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
    /*
      !inner on the jobs relation means only companies with at least one live
      listing appear — an employer directory full of empty profiles is noise.

      And live means the date, not the label. The nightly cron that writes
      `expired` needs a service-role key that is not configured on production,
      so a listing has been sitting at `active` with an expiry in the past
      since 10 September — and this card counted it. One company was advertised
      here as having three open roles and showed two on the page behind it. The
      company page itself has always asked the date; the directory card did not.
    */
    .eq('jobs.status', 'active')
    .gt('jobs.expires_at', new Date().toISOString());

  /*
    Matched on the words, not pasted into the filter language.

    `.or()` takes a PostgREST expression, and this interpolated the raw query
    into it — so a search containing a comma became extra OR terms, one
    containing `)` became a syntax error, and `%` or `_` became ilike wildcards
    nobody typed. A company called "الرواد، للتطوير" could not be searched for
    by its own name.
  */
  if (q) {
    const needle = likeNeedle(q);
    if (needle) query = query.or(`name_ar.ilike.%${needle}%,name_en.ilike.%${needle}%`);
  }
  if (verifiedOnly) query = query.eq('verification_status', 'verified');
  if (districtId) query = query.eq('district_id', districtId);

  const from = (page - 1) * COMPANIES_PER_PAGE;
  const { data, error, count } = await query
    .order('verification_status', { ascending: true })
    .order('name_ar')
    // The last key, so the order is total. Two companies sharing a name would
    // otherwise be returned in whatever order the planner felt like, which
    // across a page boundary shows one twice and the other never.
    .order('id')
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

/**
 * Cached per request: `generateMetadata`, the page body, and the banner the
 * job board shows when it is pinned to one company all ask for the same row,
 * and without this each of them paid for it.
 */
export const getCompanyBySlug = cache(async function getCompanyBySlug(
  slug: string,
): Promise<CompanyProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('companies')
    .select('*, district:districts (id, governorate_id, name_ar, name_en, slug)')
    .eq('slug', slug)
    .maybeSingle();

  if (error) raise(error, 'loading a company');
  return (data as unknown as CompanyProfile) ?? null;
});

export function isVerified(status: VerificationStatus): boolean {
  return status === 'verified';
}
