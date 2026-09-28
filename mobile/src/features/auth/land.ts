import { useCallback } from 'react';
import { router, useNavigation, useSegments, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { fetchViewer, secondFactorDue } from '~/lib/session';
import { appPathFor, intentParams, type AuthIntent } from './intent';

/**
 * Where a finished sign-in goes — the website's landing, step for step
 * (src/lib/auth/landing.ts and the onboarding page):
 *
 *   1. an authenticator on the account and not yet used this session → its code;
 *   2. no profile yet → onboarding, with the door's role and the destination;
 *   3. otherwise the sheet closes, onto wherever the person was headed.
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

      close();
      if (intent.next) router.navigate(appPathFor(intent.next) as Href);
    },
    [queryClient, close],
  );
}

/**
 * Close the flow this screen belongs to: the whole sign-in sheet from any
 * screen inside it, or this screen itself when it stands alone (onboarding,
 * the code, an email link). What was underneath is left as it was.
 */
export function useCloseFlow() {
  const navigation = useNavigation();
  const inSheet = useSegments()[0] === '(auth)';

  return useCallback(() => {
    // Inside the sheet, this screen's parent is the sheet as the root stack
    // holds it; popping that closes every screen in it at once.
    const target = inSheet ? (navigation.getParent() ?? navigation) : navigation;
    if (target.canGoBack()) target.goBack();
    else router.replace('/');
  }, [navigation, inSheet]);
}
