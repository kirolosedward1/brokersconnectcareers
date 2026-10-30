import { useEffect, useRef } from 'react';
import { router, useRootNavigationState, useSegments } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession, type Viewer } from '~/lib/session';
import { useOnboardingHeld } from '~/lib/onboarding-hold';
import { leaveSheets } from '~/lib/sheet-gate';

/**
 * What the website's middleware and onboarding page enforce, on the phone: a
 * session on an account with an authenticator it has not answered goes to the
 * code, and an account with no profile goes to onboarding — whether it came
 * from a sign-in just now, a session restored at launch, or a link. Not while
 * one of those flows is already on screen: they hand over to each other
 * themselves (useLand), and a second push would stack a copy on top. The
 * welcome is one of them: its round Google and Apple buttons sign in there
 * and hand over the same way, once the sign-in has finished (Apple's name
 * saved, say) — pushed over it before then, onboarding opened twice.
 */
const FLOWS = new Set(['(auth)', 'onboarding', 'mfa', 'auth', 'welcome']);

export function SessionGate() {
  const { ready, session, viewer, secondFactorDue } = useSession();
  const queryClient = useQueryClient();
  const segments = useSegments();
  const navigationReady = Boolean(useRootNavigationState()?.key);
  const inFlow = FLOWS.has(segments[0] ?? '');
  // A screen making the profile itself (guest apply, onboarding-hold.ts) is let finish first.
  const held = useOnboardingHeld();
  const needsProfile = Boolean(session && viewer && !viewer.profile && !viewer.profileUnreadable && !held);
  // A flow on its way, waiting for a sheet to close first: not asked for twice.
  const going = useRef(false);

  useEffect(() => {
    if (!navigationReady || !ready || !session || inFlow || going.current) return;
    let flow: '/mfa' | '/onboarding' | null = null;
    if (secondFactorDue) flow = '/mfa';
    else if (needsProfile) {
      // The read onboarding finished with is in the cache a moment before it
      // reaches this screen: as the flow closed, the profile it had just
      // made was not here yet, and onboarding opened a second time.
      const latest = queryClient.getQueryData<Viewer>(['viewer', session.user.id]);
      if (latest?.profile || latest?.profileUnreadable) return;
      flow = '/onboarding';
    }
    if (!flow) return;
    const to = flow;
    // A sheet still showing is closed first: presented over it, the flow
    // made iOS take it down unawares, and its button did nothing after.
    going.current = true;
    leaveSheets(() => {
      going.current = false;
      router.push(to);
    });
  }, [navigationReady, ready, session, inFlow, secondFactorDue, needsProfile, queryClient]);

  return null;
}
