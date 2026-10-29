import type { AnalyticsRole } from '@/lib/analytics/events';
import type { Actor } from '@/lib/permissions';

/** Who did it, in the vocabulary's words: signed out, signed in without a profile, or the profile's role. */
export function analyticsRole(actor: Actor, signedIn: boolean): AnalyticsRole {
  if (!signedIn) return 'visitor';
  const role = actor?.profile?.role;
  if (role === 'candidate' || role === 'employer' || role === 'admin') return role;
  return 'pending';
}
