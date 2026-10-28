/**
 * Where a browser sign-in used to send the person back. Google sign-in no
 * longer opens one; a code that still arrives at this address is exchanged
 * by the callback screen. Supabase's redirect allow list may still name it.
 */
export const OAUTH_REDIRECT = 'brokersconnect://auth/callback';

/**
 * Whether a browser sign-in is waiting for its return.
 *
 * Google sign-in no longer opens one. A code that still comes back — a build
 * that did — can arrive twice: iOS hands the address to the screen that
 * opened the browser, and Android also delivers it as a link. The two would
 * exchange the same single-use code, and whichever came second was refused.
 * While something waits, that link is left to it (src/app/+native-intent.tsx).
 * One that comes when nothing waits still opens the callback screen.
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
