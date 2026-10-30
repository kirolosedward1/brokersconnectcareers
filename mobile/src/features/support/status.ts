import { useQuery } from '@tanstack/react-query';
import { ApiError, getJson } from '~/lib/api';

export type ServiceStatus = 'ok' | 'degraded' | 'down';

/**
 * Whether the platform is serving, as the website's own health check says
 * (/api/health): "ok", "degraded" (the pages serve, some mail may wait), or
 * down (a 503). The public answer is one word; nothing about the
 * configuration reaches the phone. Unanswered — no connection — is not "down".
 */
export function useServiceStatus() {
  return useQuery({
    queryKey: ['support', 'status'],
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<ServiceStatus> => {
      try {
        const body = await getJson<{ status?: string }>('/api/health');
        return body.status === 'ok' ? 'ok' : 'degraded';
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 503) return 'down';
        throw failure;
      }
    },
  });
}
