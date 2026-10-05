import { useCallback } from 'react';
import { router, useNavigation, useSegments } from 'expo-router';
import { StackActions } from 'expo-router/react-navigation';
import { useQueryClient } from '@tanstack/react-query';
import { openWhenReady } from '~/lib/open-path';
import { fetchViewer, secondFactorDue } from '~/lib/session';
import { intentParams, type AuthIntent } from './intent';
import { forgetOnboardingIntent } from './kept-intent';

/**
 * Where a finished sign-in goes — the website's landing, step for step
 * (src/lib/auth/landing.ts and the onboarding page):
 *
 *   1. an authenticator on the account and not yet used this session → its code;
 *   2. no profile yet → onboarding, with the door's role and the destination;
 *   3. otherwise the sheet closes, onto wherever the person was headed — once
 *      the app has been drawn for the account (open-path.ts), and only if the
 *      account may open it (the same rules as any link).
 *
 * Steps 1 and 2 *replace* the screen they are called from, so the account is
 * never on screen half-arrived — the session gate in the root layout would
 * otherwise see a signed-in account with no profile and step in itself.
 * A profile that could not be read is not a missing one (the website's rule):
 * the person goes on, and onboarding is not offered to an established account.
 */
export function useLand() {
  const queryClient = useQueryClient();
  const close = useCloseFlow();

  return useCallback(
    async (intent: AuthIntent) => {
      if (await secondFactorDue().catch(() => false)) {
        router.replace({ pathname: '/mfa', params: intentParams(intent) });
        return;
      }

      const viewer = await fetchViewer(queryClient).catch(() => null);
      if (viewer && !viewer.profile && !viewer.profileUnreadable) {
        router.replace({ pathname: '/onboarding', params: intentParams(intent) });
        return;
      }

      // Arrived: onboarding's kept destination has done its work.
      void forgetOnboardingIntent();
      close('arrived');
      if (intent.next) openWhenReady(intent.next);
    },
    [queryClient, close],
  );
}

/**
 * The sign-in flow's screens as the root stack names them: the sheet, the
 * ones that stand alone, and the welcome a first launch opens on, which a
 * sign-in started from it closes along with the sheet.
 */
const FLOW_SCREENS = new Set(['(auth)', 'onboarding', 'mfa', 'auth/confirm', 'auth/callback', 'welcome']);

/**
 * Close the flow this screen belongs to: the whole sign-in sheet from any
 * screen inside it, or this screen itself when it stands alone (onboarding,
 * the code, an email link). What was underneath is left as it was.
 *
 * `'arrived'` — the account is in — closes every screen of the flow on top
 * of the app, not only this one: an email link opened over the sign-up sheet
 * left the sheet's "check your email" under onboarding, and finishing
 * onboarding showed it again, for an account that had just arrived.
 */
export function useCloseFlow() {
  const navigation = useNavigation();
  const inSheet = useSegments()[0] === '(auth)';

  return useCallback(
    (how: 'this' | 'arrived' = 'this') => {
      // Inside the sheet, this screen's parent is the sheet as the root stack
      // holds it; popping that closes every screen in it at once.
      const target = inSheet ? (navigation.getParent() ?? navigation) : navigation;
      if (how === 'arrived') {
        const routes = target.getState()?.routes ?? [];
        let flow = 0;
        while (flow < routes.length && FLOW_SCREENS.has(routes[routes.length - 1 - flow].name)) flow += 1;
        if (flow > 0 && flow < routes.length) {
          target.dispatch(StackActions.pop(flow));
          return;
        }
      }
      if (target.canGoBack()) target.goBack();
      else router.replace('/');
    },
    [navigation, inSheet],
  );
}
