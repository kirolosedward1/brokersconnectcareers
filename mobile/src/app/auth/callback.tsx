import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslations } from 'use-intl';
import { AuthHeading, AuthScroll } from '~/components/auth/auth-scroll';
import { Button } from '~/components/ui/button';
import { LoadingState } from '~/components/ui/states';
import { NO_INTENT } from '~/features/auth/intent';
import { useCloseFlow, useLand } from '~/features/auth/land';
import { completeOAuth, OAUTH_REDIRECT } from '~/features/auth/providers';
import { useSession } from '~/lib/session';
import { space } from '~/theme/tokens';

/**
 * brokersconnect://auth/callback — a code handed back to the app.
 *
 * Google sign-in no longer returns here: the device's Google sheet gives an
 * identity token, and Supabase exchanges that. A link that does arrive — a
 * build that still opened the browser, or the system handing the address
 * over as an ordinary link — exchanges its code here. The code is single-use,
 * so that can only happen once.
 */
export default function OAuthCallbackScreen() {
  const t = useTranslations();
  const params = useLocalSearchParams<Record<string, string>>();
  const { ready, session } = useSession();
  const land = useLand();
  const close = useCloseFlow();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    if (session && !params.code) {
      void land(NO_INTENT).catch(() => setFailed(true));
      return;
    }
    const query = new URLSearchParams(params).toString();
    void completeOAuth(`${OAUTH_REDIRECT}?${query}`)
      .then(async (outcome) => {
        if (outcome.ok) await land(NO_INTENT);
        else if (outcome.cancelled) close();
        else setFailed(true);
      })
      // Thrown rather than answered: said, never a spinner that does not end.
      .catch(() => setFailed(true));
  }, [ready, session, params, land, close]);

  if (failed) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AuthScroll bare>
          <View style={{ height: space[8] }} />
          <AuthHeading title={t('common.error')} body={t('common.errorBody')} />
          <Button label={t('common.close')} variant="outline" onPress={() => close()} />
        </AuthScroll>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <LoadingState />
    </>
  );
}
