import { useEffect, useRef } from 'react';
import { router, usePathname, useRootNavigationState, useSegments } from 'expo-router';
import { useLaunchHeld } from '~/features/launch';
import { welcomeOpens } from '~/features/welcome';
import { useSession } from '~/lib/session';

/**
 * Opens the welcome (src/app/welcome.tsx) whenever nobody is signed in: over
 * Home at every launch of the app as itself — not by a link, which goes where
 * it leads — and again when the reader signs out. The launch is decided once
 * the session and the navigation have both answered, and the launch curtain
 * has been up its moment (src/features/launch.ts) — the welcome fades in over
 * it; `onDecided` says whether it opened, so the curtain stays until the
 * first screen is the right one. Skipping it closes it until the app is next
 * started.
 */
export function WelcomeGate({ onDecided }: { onDecided: (opened: boolean) => void }) {
  const { ready, session } = useSession();
  const navigationReady = Boolean(useRootNavigationState()?.key);
  const pathname = usePathname();
  const first = useSegments()[0];
  const overTabs = first === '(tabs)';
  // The welcome on screen already: it is the answer to a sign-out, not a reason for another.
  const onWelcome = first === 'welcome';
  const decided = useRef(false);
  const curtainHeld = useLaunchHeld();
  // A sign-out still to be answered with the welcome (below).
  const due = useRef(false);

  useEffect(() => {
    if (decided.current || !navigationReady || !ready || !curtainHeld) return;
    decided.current = true;
    const open = welcomeOpens() && !session && pathname === '/';
    // Opened now, it also answers a sign-out made while the launch was still deciding: not opened twice.
    if (open) due.current = false;
    if (open) router.push('/welcome');
    onDecided(open);
  }, [navigationReady, ready, curtainHeld, session, pathname, onDecided]);

  // Somebody signed in who signs out — on Account, from the code or
  // onboarding, or a session that ended — is welcomed again: once whatever
  // they signed out from has closed, so nothing is left between the tabs and
  // the welcome for that screen's own Back to close instead. Signing in again
  // first leaves it unopened, and so does closing back onto a welcome that was
  // under it (signed in from the welcome, then out from the code or onboarding).
  const signedIn = useRef<boolean | null>(null);
  useEffect(() => {
    if (!ready) return;
    const now = Boolean(session);
    if (signedIn.current === true && !now) due.current = true;
    // Signed in again, or back on a welcome that was under the screen signed out from.
    if (now || onWelcome) due.current = false;
    signedIn.current = now;
    if (!due.current || !overTabs || !decided.current) return;
    due.current = false;
    if (welcomeOpens()) router.push('/welcome');
  }, [ready, session, overTabs, onWelcome]);

  return null;
}
