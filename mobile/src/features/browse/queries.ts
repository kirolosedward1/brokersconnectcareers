import { useQuery } from '@tanstack/react-query';
import type { BrowseResponse, LandingResponse } from '@/lib/mobile-api/reads';
import { getJson } from '~/lib/api';

/**
 * How many live listings sit behind each way into the board — per district,
 * per track, per company type, and per track-in-district pair. The website's
 * home page reads exactly this (getBrowseCounts), so the figures on the phone
 * and on the site agree, and each agrees with the board it opens.
 */
export function useBrowseCounts() {
  return useQuery({
    queryKey: ['browse'],
    queryFn: () => getJson<BrowseResponse>('/api/mobile/v1/browse'),
    staleTime: 60_000,
  });
}

/** The facts a track-in-a-district page leads with (`/jobs/primary-new-cairo`). */
export function useLanding(slug: string) {
  return useQuery({
    queryKey: ['landing', slug],
    queryFn: () => getJson<LandingResponse>(`/api/mobile/v1/landing/${encodeURIComponent(slug)}`),
    enabled: slug.length > 0,
    staleTime: 60_000,
  });
}
