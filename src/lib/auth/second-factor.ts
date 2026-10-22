/**
 * An account with an authenticator, signed in with the password alone: where
 * a page of the account sends it instead — the account page's challenge,
 * carrying the page it was on its way to. Null for the account page itself,
 * which draws the challenge and nothing else until it is answered.
 *
 * Every account, not only an admin: the account page tells everyone who sets
 * one up that the code "is asked for alongside your password", and the app
 * asks on the phone (mobile/src/components/navigation/session-gate.tsx).
 *
 * `path` without its locale, as the middleware reads it; `search` with its '?'.
 */
export function secondFactorChallenge(path: string, search: string): string | null {
  if (path === '/dashboard/account') return null;
  const params = new URLSearchParams({ mfa: 'challenge', next: path + search });
  return `/dashboard/account?${params.toString()}`;
}

/** A Supabase user as the auth server returned it: only the factor list is read. */
type FactorHolder = { factors?: readonly { status: string }[] | null } | null | undefined;

/**
 * The assurance level an access token states (its `aal` claim), or null when
 * it states none or cannot be read. Only ever asked of a token the auth server
 * has just accepted (getUser), which is what makes the claim worth reading:
 * decoding is not verifying.
 */
export function tokenAssurance(accessToken: string | null | undefined): string | null {
  const payload = accessToken?.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))) as { aal?: unknown };
    return typeof claims.aal === 'string' ? claims.aal : null;
  } catch {
    return null;
  }
}

/**
 * An account with a verified authenticator whose session has not used it:
 * signed in with the password alone.
 *
 * Judged from the user the auth server returned and the token it accepted —
 * never from the copy of the user a session cookie carries. supabase-js's
 * `mfa.getAuthenticatorAssuranceLevel()` with no argument reads the factor
 * list from that copy, which the browser holds and can edit: a password and
 * a cookie with `factors` emptied out walked past the challenge.
 */
export function secondFactorDue(user: FactorHolder, accessToken: string | null | undefined): boolean {
  if (!user?.factors?.some((factor) => factor.status === 'verified')) return false;
  return tokenAssurance(accessToken) !== 'aal2';
}
