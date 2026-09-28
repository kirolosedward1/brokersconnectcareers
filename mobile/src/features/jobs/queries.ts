import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { JobListItem } from '@/lib/job-list';
import type { JobBoardResponse, JobDetailResponse } from '@/lib/mobile-api/reads';
import { getJson } from '~/lib/api';

/**
 * The board: the website's /jobs query string, answered by the website's own
 * query through /api/mobile/v1/jobs, a page of twenty at a time.
 *
 * `query` is the canonical filter string (serializeJobFilters) without the
 * page, so one filter set is one cache entry however it was reached.
 */
export function useJobBoard(query: string) {
  return useInfiniteQuery({
    queryKey: ['jobs', 'board', query],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(query);
      if (pageParam > 1) params.set('page', String(pageParam));
      const search = params.toString();
      return getJson<JobBoardResponse>(`/api/mobile/v1/jobs${search ? `?${search}` : ''}`);
    },
    // Paging is by offset and the server may serve an earlier page than asked
    // for, so the next page is the one after what actually came back.
    getNextPageParam: (last) => (last.page < last.pageCount ? last.page + 1 : undefined),
  });
}

/**
 * Every listing across the pages loaded so far, each once. A listing published
 * between two page loads shifts the offsets, so the same row can arrive on two
 * pages; it is drawn once.
 */
export function flattenBoard(pages: JobBoardResponse[] | undefined): JobListItem[] {
  const seen = new Set<string>();
  const jobs: JobListItem[] = [];
  for (const page of pages ?? []) {
    for (const job of page.jobs) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      jobs.push(job);
    }
  }
  return jobs;
}

/** One listing, as this reader may see it — so the token rides along when there is one. */
export function useJob(slug: string) {
  return useQuery({
    queryKey: ['jobs', 'detail', slug],
    queryFn: () => getJson<JobDetailResponse>(`/api/mobile/v1/jobs/${encodeURIComponent(slug)}`, { signedIn: true }),
    enabled: slug.length > 0,
  });
}
