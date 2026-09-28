import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { CompanyListItem } from '@/lib/read-types';
import type { CompanyListResponse, CompanyPageResponse } from '@/lib/mobile-api/reads';
import { getJson } from '~/lib/api';

/**
 * The company directory: the website's /companies, parameter for parameter —
 * a few words, a district, verified only — twenty-four to a page, answered by
 * the website's own query through /api/mobile/v1/companies.
 */
export type CompanyQuery = { q: string; district: string | null; verified: boolean };

export function companySearch(query: CompanyQuery, page = 1): string {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set('q', query.q.trim().slice(0, 120));
  if (query.district) params.set('district', query.district);
  if (query.verified) params.set('verified', '1');
  if (page > 1) params.set('page', String(page));
  return params.toString();
}

export function useCompanyDirectory(query: CompanyQuery) {
  return useInfiniteQuery({
    queryKey: ['companies', 'directory', companySearch(query)],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const search = companySearch(query, pageParam);
      return getJson<CompanyListResponse>(`/api/mobile/v1/companies${search ? `?${search}` : ''}`);
    },
    // As on the board: the server may answer an earlier page than asked for.
    getNextPageParam: (last) => (last.page < last.pageCount ? last.page + 1 : undefined),
  });
}

/** Every company across the pages loaded so far, each once. */
export function flattenCompanies(pages: CompanyListResponse[] | undefined): CompanyListItem[] {
  const seen = new Set<string>();
  const companies: CompanyListItem[] = [];
  for (const page of pages ?? []) {
    for (const company of page.companies) {
      if (seen.has(company.id)) continue;
      seen.add(company.id);
      companies.push(company);
    }
  }
  return companies;
}

/** A company's public page and its newest live listings. */
export function useCompany(slug: string) {
  return useQuery({
    queryKey: ['companies', 'page', slug],
    queryFn: () => getJson<CompanyPageResponse>(`/api/mobile/v1/companies/${encodeURIComponent(slug)}`),
    enabled: slug.length > 0,
  });
}
