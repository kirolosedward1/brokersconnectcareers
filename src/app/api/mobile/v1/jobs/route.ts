import { publicRead, searchParamsOf } from '@/lib/mobile-api/http';
import { activeFilterList, JOBS_PER_PAGE, parseJobFilters } from '@/lib/job-filters';
import { countJobs, queryJobs } from '@/lib/queries/jobs';
import { getCompanyBySlug } from '@/lib/queries/companies';
import { createPublicClient } from '@/lib/supabase/public';

/**
 * GET /api/mobile/v1/jobs?<the /jobs query string> — the job board.
 *
 * The same parser and the same query the website's /jobs page runs, so a
 * search on the phone and the same search on the site return the same
 * listings in the same order. Filters are the website's URL parameters
 * (q, track, district, gov, salary, pay, comm, posted, company, ctype, exp,
 * type, leads, sort, page).
 *
 * Anonymous and shared: the board is the same for every reader, so the app
 * sends no token here and the CDN may keep an answer for a minute. Saved and
 * applied badges are the app's own two reads under its session.
 *
 * On an empty board with more than one filter, `relaxations` says which single
 * filter to drop and how many listings that would bring back — keys match
 * activeFilterList(), the same list the website's chips come from.
 *
 * Paging is by offset and `page` is the page actually served, which can be an
 * earlier one than asked for; the app de-duplicates by id when it appends.
 */
export const dynamic = 'force-dynamic';

export const GET = publicRead(async (request) => {
  const filters = parseJobFilters(searchParamsOf(request));
  const client = createPublicClient();

  const result = await queryJobs(filters, client);

  const active = activeFilterList(filters);
  const relaxations =
    result.jobs.length === 0 && active.length > 1
      ? (
          await Promise.all(
            active.slice(0, 6).map(async (filter) => ({
              key: filter.key,
              count: await countJobs({ ...filters, ...filter.without, page: 1 }, client),
            })),
          )
        )
          .filter((filter): filter is { key: string; count: number } => Boolean(filter.count))
          .sort((a, b) => b.count - a.count)
      : [];

  // The pinned company's banner: who "only this company's roles" means.
  const company = filters.companySlug ? await getCompanyBySlug(filters.companySlug) : null;

  return {
    ...result,
    pageSize: JOBS_PER_PAGE,
    relaxations,
    company: company
      ? {
          id: company.id,
          slug: company.slug,
          name_ar: company.name_ar,
          name_en: company.name_en,
          logo_url: company.logo_url,
          verification_status: company.verification_status,
        }
      : null,
  };
});
