/**
 * Whether an app session may pull the admin console's levers — the website's
 * requireAdmin(), asked of a bearer token instead of a page visit.
 *
 * The console asks two things of a session beyond the admin role, and the app
 * is held to both, server-side, before any admin action runs:
 *
 *   - an admin who has an authenticator must have used it this session (aal2).
 *     The database already insists (migration 311: is_admin() is false at
 *     aal1 for such an account), so this only turns its silent refusal into a
 *     word the app can act on — "enter your code".
 *   - where the deployment requires one (ADMIN_MFA_REQUIRED=true; unset means
 *     it does not), an admin without an authenticator is turned away until
 *     they set one up — the same rule that sends them from /admin to enrol.
 *
 * The role itself is the action's to check (assertAdmin) and the database's
 * to enforce (every admin_* function calls admin_begin()).
 *
 * Pure, so the rules can be tested without a server; the token reaching here
 * has already been verified by the auth server at the door (http.ts), so its
 * claims are read, not re-checked.
 */

/** What the door says: go ahead, answer the challenge first, or set up a second factor first. */
export type AdminDoor = 'open' | 'mfa_challenge' | 'mfa_required';

type Caller = {
  jwt: string;
  user: { factors?: readonly { status: string }[] | null };
};

/** The assurance level a verified access token carries; anything unreadable is the lower one. */
export function assuranceOf(jwt: string): 'aal1' | 'aal2' {
  const segment = jwt.split('.')[1] ?? '';
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as { aal?: unknown };
    return claims?.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch {
    return 'aal1';
  }
}

export function adminDoor(caller: Caller, mfaRequired: boolean): AdminDoor {
  if (assuranceOf(caller.jwt) === 'aal2') return 'open';
  if (caller.user.factors?.some((factor) => factor.status === 'verified')) return 'mfa_challenge';
  return mfaRequired ? 'mfa_required' : 'open';
}
