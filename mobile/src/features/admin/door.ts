import { useQuery } from '@tanstack/react-query';
import { isAdmin } from '@/lib/permissions';
import { useMobileConfig } from '~/features/config';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { withTimeout } from '~/lib/timeout';

/**
 * Whether the console opens for this session — the website's requireAdmin(),
 * on the phone.
 *
 *   open       the authenticator's code was given this session, or the
 *              deployment lets an admin without one in
 *   challenge  the account has an authenticator not yet used this session
 *              (SessionGate is already asking for the code)
 *   enrol      the deployment requires an authenticator (ADMIN_MFA_REQUIRED,
 *              from /config) and the account has none yet
 *   checking   not known yet
 *
 * This decides what to show. What the levers may do is decided again on the
 * website (mobile-api/admin-door.ts) and in the database (is_admin()), for a
 * request that never went near this screen.
 */
export type DoorState = 'checking' | 'open' | 'challenge' | 'enrol';

/** How long reading the session's level may take; it is read from the phone, so this is a stall, not a slow line. */
const LEVEL_TIMEOUT_MS = 10_000;
const REFRESH_TIMEOUT_MS = 20_000;

export function useAdminDoor(): { state: DoorState; recheck: () => Promise<void> } {
  const { session, actor } = useSession();
  const config = useMobileConfig();
  // Per token: a refreshed session (a factor added on the website, a code given) is asked afresh.
  const token = session?.access_token.slice(-24) ?? null;
  const level = useQuery({
    queryKey: ['admin-door', session?.user.id ?? null, token],
    enabled: isAdmin(actor) && Boolean(token),
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        LEVEL_TIMEOUT_MS,
        'reading the sign-in level',
      );
      if (error) throw error;
      return { current: data.currentLevel, next: data.nextLevel };
    },
  });

  // A factor set up on the website reaches this phone with the session's next refresh: asked for now.
  const recheck = async () => {
    await withTimeout(supabase.auth.refreshSession(), REFRESH_TIMEOUT_MS, 'refreshing the session').catch(() => {});
    await level.refetch();
  };

  let state: DoorState = 'checking';
  if (level.data?.current === 'aal2') state = 'open';
  else if (level.data?.next === 'aal2') state = 'challenge';
  else if (level.data || level.isError) {
    // Unreadable is not "no authenticator": a server older than the setting, or
    // a config that could not be read, is held to the stricter rule.
    if (config.data) state = config.data.adminMfaRequired === false ? 'open' : 'enrol';
    else if (config.isError) state = 'enrol';
  }
  return { state, recheck };
}
