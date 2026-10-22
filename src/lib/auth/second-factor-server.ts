import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { mobileScope } from '@/lib/mobile-api/context';
import { secondFactorDue } from './second-factor';

/**
 * Whether the caller's session still owes the account's second factor —
 * for an action or a route to refuse before it does anything it cannot take
 * back.
 *
 * `user` must be the auth server's answer (getUser), whose factor list is the
 * real one. The token is the app's bearer inside a mobile route, which the
 * door has already held to this rule, and the cookie session's otherwise.
 */
export async function sessionOwesSecondFactor(supabase: SupabaseClient, user: User): Promise<boolean> {
  const mobile = mobileScope();
  if (mobile) return mobile.session ? secondFactorDue(user, mobile.session.jwt) : false;
  const { data } = await supabase.auth.getSession();
  return secondFactorDue(user, data.session?.access_token);
}
