import { useQuery } from '@tanstack/react-query';
import type { MobileConfig } from '@/lib/mobile-api/reads';
import { getJson } from '~/lib/api';

/**
 * What the website says about itself: which one-tap sign-ins the auth server
 * accepts today, whether it wants a captcha with a password, the address the
 * footer offers for help. Asked of /api/mobile/v1/config rather than built
 * into the app, so turning Google on in the Supabase dashboard reaches phones
 * without a release — the same reason the website asks GoTrue rather than
 * reading a flag. Cached at the edge for five minutes, and for as long here.
 */
export function useMobileConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => getJson<MobileConfig>('/api/mobile/v1/config'),
    staleTime: 5 * 60_000,
  });
}
