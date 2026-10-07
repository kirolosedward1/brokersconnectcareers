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
