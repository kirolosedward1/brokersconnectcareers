import { useEffect, useRef } from 'react';
import { router, usePathname, useRootNavigationState, useSegments } from 'expo-router';
import { welcomeOpens } from '~/features/welcome';
import { useSession } from '~/lib/session';

/**
 * Opens the welcome (src/app/welcome.tsx) whenever nobody is signed in: over
 * Home at every launch of the app as itself — not by a link, which goes where
 * it leads — and again when the reader signs out. The launch is decided once
 * the session and the navigation have both answered; `onDecided` says whether
 * it opened, so the splash screen stays up until the first screen is the
 * right one. Skipping it closes it until the app is next started.
 */
export function WelcomeGate({ onDecided }: { onDecided: (opened: boolean) => void }) {
  const { ready, session } = useSession();
  const navigationReady = Boolean(useRootNavigationState()?.key);
  const pathname = usePathname();
  const overTabs = useSegments()[0] === '(tabs)';
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current || !navigationReady || !ready) return;
    decided.current = true;
    const open = welcomeOpens() && !session && pathname === '/';
    if (open) router.push('/welcome');
    onDecided(open);
  }, [navigationReady, ready, session, pathname, onDecided]);

  // Somebody signed in who signs out — on Account, from the code or
  // onboarding, or a session that ended — is welcomed again: once whatever
  // they signed out from has closed, so nothing is left between the tabs and
  // the welcome for that screen's own Back to close instead. Signing in again
  // first leaves it unopened.
  const signedIn = useRef<boolean | null>(null);
  const due = useRef(false);
  useEffect(() => {
    if (!ready) return;
    const now = Boolean(session);
    if (signedIn.current === true && !now) due.current = true;
    if (now) due.current = false;
    signedIn.current = now;
    if (!due.current || !overTabs || !decided.current) return;
    due.current = false;
    if (welcomeOpens()) router.push({ pathname: '/welcome', params: { after: 'sign-out' } });
  }, [ready, session, overTabs]);

  return null;
}
