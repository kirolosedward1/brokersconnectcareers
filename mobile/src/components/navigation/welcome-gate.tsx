import { useEffect, useRef } from 'react';
import { router, usePathname, useRootNavigationState } from 'expo-router';
import { useWelcomeState, welcomeAnswered } from '~/features/welcome';
import { useSession } from '~/lib/session';

/**
 * Opens the welcome (src/app/welcome.tsx) over Home on a launch that has it
 * due: nobody signed in, the welcome not yet answered on this phone, and the
 * app opened as itself — not by a link, which goes where it leads. Decided
 * once a launch, when the session, the phone and the navigation have all
 * answered; `onDecided` says whether it opened, so the splash screen stays
 * up until the first screen is the right one.
 *
 * Signing in answers the welcome for good. A session the launch found does
 * not: a phone that was signed in when a new welcome came is welcomed at its
 * first launch with nobody signed in.
 */
export function WelcomeGate({ onDecided }: { onDecided: (opened: boolean) => void }) {
  const { ready, session } = useSession();
  const welcome = useWelcomeState();
  const navigationReady = Boolean(useRootNavigationState()?.key);
  const pathname = usePathname();
  const decided = useRef(false);

  // Nobody signed in, at some point since the session was known: a session after that is a sign-in.
  const signedOut = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (!session) signedOut.current = true;
    else if (signedOut.current) welcomeAnswered();
  }, [ready, session]);

  useEffect(() => {
    if (decided.current || !navigationReady || !ready || welcome === 'unknown') return;
    decided.current = true;
    const open = !session && welcome === 'due' && pathname === '/';
    if (open) router.push('/welcome');
    onDecided(open);
  }, [navigationReady, ready, welcome, session, pathname, onDecided]);

  return null;
}
