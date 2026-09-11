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
}): Promise<{
  companies: CompanyListItem[];
  total: number;
  pageCount: number;
  /** The page actually returned, which is not always the one asked for. */
  page: number;
}> {
  const supabase = await createClient();

  /*
    Built fresh each time rather than held in one variable.

    PostgREST refuses an offset past the end of the result set outright —
    PGRST103, "Requested range not satisfiable" — so `/companies?page=400` did
    not render an empty directory, it rendered the error boundary carrying the
    database's own sentence about offsets. `queryJobs` learned this in round 3
    and this side was never revisited. The recovery below has to issue a second
    query with a different range, and a builder that has already been awaited
    is not something to lean on for that.
  */
  const build = () => {
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

  return query
    .order('verification_status', { ascending: true })
    .order('name_ar')
    // The last key, so the order is total. Two companies sharing a name would
    // otherwise be returned in whatever order the planner felt like, which
    // across a page boundary shows one twice and the other never.
    .order('id');
  };

  const pageOf = (wanted: number) => {
    const from = (wanted - 1) * COMPANIES_PER_PAGE;
    return build().range(from, from + COMPANIES_PER_PAGE - 1);
  };

  const { data, error, count } = await pageOf(page);

  /*
    A page past the end is answered with the end.

    Two failures live here, the same two the board had. A page just past the
    last one comes back empty and the directory renders "no companies match" —
    on a search that matches seven. And a page far enough past it does not come
    back at all: PGRST103, which `raise` turns into the error boundary carrying
    the database's message. Both are the same question — how many pages are
    there — which is only answerable after a query.
  */
  if (error?.code === 'PGRST103' || (!error && count != null && page > 1 && !data?.length)) {
    const { count: total, error: countError } = await pageOf(1);
    if (countError) raise(countError, 'listing companies');

    const pageCount = Math.max(1, Math.ceil((total ?? 0) / COMPANIES_PER_PAGE));
    const { data: lastPage, error: lastError } = await pageOf(pageCount);
    if (lastError) raise(lastError, 'listing companies');

    return {
      companies: (lastPage ?? []) as unknown as CompanyListItem[],
      total: total ?? 0,
      pageCount,
      page: pageCount,
    };
  }

  if (error) raise(error, 'listing companies');

  const total = count ?? 0;
  return {
    companies: (data ?? []) as unknown as CompanyListItem[],
    total,
    pageCount: Math.max(1, Math.ceil(total / COMPANIES_PER_PAGE)),
    page,
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
