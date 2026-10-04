import { useEffect } from 'react';
import { router, useRootNavigationState, useSegments } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession, type Viewer } from '~/lib/session';

/**
 * What the website's middleware and onboarding page enforce, on the phone: a
 * session on an account with an authenticator it has not answered goes to the
 * code, and an account with no profile goes to onboarding — whether it came
 * from a sign-in just now, a session restored at launch, or a link. Not while
 * one of those flows is already on screen: they hand over to each other
 * themselves (useLand), and a second push would stack a copy on top.
 */
const FLOWS = new Set(['(auth)', 'onboarding', 'mfa', 'auth']);

export function SessionGate() {
  const { ready, session, viewer, secondFactorDue } = useSession();
  const queryClient = useQueryClient();
  const segments = useSegments();
  const navigationReady = Boolean(useRootNavigationState()?.key);
  const inFlow = FLOWS.has(segments[0] ?? '');
  const needsProfile = Boolean(session && viewer && !viewer.profile && !viewer.profileUnreadable);

  useEffect(() => {
    if (!navigationReady || !ready || !session || inFlow) return;
    if (secondFactorDue) router.push('/mfa');
    else if (needsProfile) {
      // The read onboarding finished with is in the cache a moment before it
      // reaches this screen: as the flow closed, the profile it had just
      // made was not here yet, and onboarding opened a second time.
      const latest = queryClient.getQueryData<Viewer>(['viewer', session.user.id]);
      if (latest?.profile || latest?.profileUnreadable) return;
      router.push('/onboarding');
    }
  }, [navigationReady, ready, session, inFlow, secondFactorDue, needsProfile, queryClient]);

  return null;
}
