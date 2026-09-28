import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { raise } from './error';
import { queryWords } from '@/lib/search/arabic';
import { logFailure } from '@/lib/observe';
import type { CompanyRow, DistrictRow, VerificationStatus } from '@/lib/supabase/database.types';
import { LIST_SELECT, type JobListItem } from './jobs';

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

  // Each word of the search, folded the way companies.search_name is, and
  // made of letters and digits only — so nothing in it is PostgREST syntax or
  // an ilike wildcard. At most five: a company name is not a paragraph.
  const words = q ? queryWords(q).slice(0, 5) : [];

  // Set when the database predates migration 68 and has no search_name.
  let legacy = false;

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
    Every word somewhere in either name, however it was typed.

    search_name holds both names folded and with the article off (migration
    68), so الاهرام finds الأهرام and «رواد تطوير» finds «الرواد للتطوير» —
    neither did when this matched the raw query as one substring. Each word is
    its own `.ilike`, which PostgREST ANDs, and each operand is encoded by the
    client rather than spliced into an `or()` expression — the route by which
    a comma in a name once became extra filter terms.
  */
  for (const word of words) {
    if (legacy) {
      query = query.or(`name_ar.ilike.%${word}%,name_en.ilike.%${word}%`);
    } else {
      query = query.ilike('search_name', `%${word}%`);
    }
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

  let { data, error, count } = await pageOf(page);

  // 42703: no such column — code that has reached a database migration 68
  // has not. The raw names, as before, rather than a directory that errors.
  if (error?.code === '42703' && words.length) {
    logFailure('companies', 'search_name missing; matching raw names', { code: error.code });
    legacy = true;
    ({ data, error, count } = await pageOf(page));
  }

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

  /*
    A suspended company is not on the public site at all (migration 317): its
    listings were taken down with it, and a profile page left standing would
    keep vouching for it. Read off the row rather than filtered in the query,
    so a database that has not had the migration yet — no such column — still
    serves every company page instead of erroring on all of them.
  */
  if ((data as { suspended_at?: string | null } | null)?.suspended_at) return null;
  return (data as unknown as CompanyProfile) ?? null;
});

export function isVerified(status: VerificationStatus): boolean {
  return status === 'verified';
}

/**
 * A company's live listings, newest first.
 *
 * Cached per request because two callers need the same answer: the page body
 * lists them, and generateMetadata decides from their count whether the page
 * is worth indexing at all. Live means the date as well as the label — the
 * nightly cron is what flips `active` to `expired`.
 *
 * The error is raised, not dropped. "No open roles" on a brokerage with three
 * live adverts is a false public claim about a company; the (site) error
 * boundary is the better outcome.
 */
export const getCompanyOpenJobs = cache(async function getCompanyOpenJobs(
  companyId: string,
): Promise<{ jobs: JobListItem[]; total: number }> {
  const supabase = await createClient();
  /*
    The newest COMPANY_PAGE_JOBS, and the exact total beside them.

    This read had no bound. A brokerage with 122 live listings — the biggest in
    the load-test dataset, and a shape a single large developer reaches in a
    month — was a 1.4 MB page carrying 600 KB out of the database, rendered for
    every visitor. The board already lists a company's roles in full, paged
    (`/jobs?company=<slug>`), so the profile shows the newest and links there.
  */
  const { data, error, count } = await supabase
    .from('jobs')
    .select(LIST_SELECT, { count: 'exact' })
    .eq('company_id', companyId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('published_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(COMPANY_PAGE_JOBS);

  if (error) raise(error, "loading a company's open roles");
  return { jobs: (data ?? []) as unknown as JobListItem[], total: count ?? data?.length ?? 0 };
});

/** How many of a company's roles its profile lists before linking to the board. */
export const COMPANY_PAGE_JOBS = 20;
