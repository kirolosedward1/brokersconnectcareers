/** Where Google sends the browser back. Supabase's redirect allow list names it. */
export const OAUTH_REDIRECT = 'brokersconnect://auth/callback';

/**
 * Whether a Google sign-in is waiting for the browser to come back.
 *
 * On iOS the authentication browser hands its return address to the sign-in
 * screen alone. On Android the same address also reaches the app as an
 * ordinary link, which opened the callback screen, and the two exchanged the
 * same single-use code: whichever came second was refused, and an error
 * covered a sign-in that had worked. While the sign-in screen waits for its
 * own answer, that link is left to it (src/app/+native-intent.tsx). One that
 * comes when nothing waits — the app was closed meanwhile — still opens the
 * callback screen, which finishes the sign-in there.
 */
let waiting = 0;

export function awaitingOAuthReturn<T>(run: () => Promise<T>): Promise<T> {
  waiting += 1;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      waiting -= 1;
    });
}

/** A link that is the return a sign-in screen is already waiting for. */
export function isAwaitedOAuthReturn(url: string): boolean {
  return waiting > 0 && url.startsWith(OAUTH_REDIRECT);
}
