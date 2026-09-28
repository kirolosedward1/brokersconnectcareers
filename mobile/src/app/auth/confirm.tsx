import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslations } from 'use-intl';
import { asConfirmType, confirmDestination, isTokenHash } from '@/lib/auth/confirm-link';
import { AuthHeading, AuthScroll } from '~/components/auth/auth-scroll';
import { Button } from '~/components/ui/button';
import { LoadingState } from '~/components/ui/states';
import { intentFromPath } from '~/features/auth/intent';
import { useCloseFlow, useLand } from '~/features/auth/land';
import { env } from '~/lib/env';
import { openWhenReady } from '~/lib/open-path';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { space } from '~/theme/tokens';

/**
 * An email link, opened in the app — the website's /auth/confirm, verified
 * here instead of there: a sign-up confirmation, a password reset, a new
 * email address. The link carries a one-time token hash (never a session), so
 * it works on whichever device opens it, and the app trades it for a session
 * with Supabase directly. Where it lands is read by the website's own rules
 * (src/lib/auth/confirm-link.ts): a reset goes to the new-password screen, a
 * confirmation to onboarding with the page the person was on their way to.
 *
 * Tapping a link is the person asking for it, so it is verified at once — the
 * website's extra "Continue" step exists for mail scanners, which do not open
 * apps. Unless another account is signed in on this phone: then the person
 * is asked first, since going on signs that account out.
 */
export default function ConfirmLinkScreen() {
  const t = useTranslations();
  const params = useLocalSearchParams<{ token_hash?: string; type?: string; redirect_to?: string }>();
  const { ready, session } = useSession();
  const land = useLand();
  const close = useCloseFlow();

  const type = asConfirmType(params.type);
  const tokenHash = isTokenHash(params.token_hash) ? params.token_hash : null;
  const valid = Boolean(type && tokenHash);

  const [state, setState] = useState<'idle' | 'verifying' | 'failed'>(valid ? 'idle' : 'failed');
  const started = useRef(false);
  // A new address is confirmed by the account it belongs to, which is the one
  // signed in: nothing to ask. Any other link while signed in asks first.
  const ask = state === 'idle' && ready && Boolean(session) && type !== 'email_change';

  const verify = useCallback(async () => {
    if (!type || !tokenHash) return;
    setState('verifying');
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      setState('failed');
      return;
    }

    const destination = confirmDestination(type, params.redirect_to ?? null, env.siteUrl);
    if (type === 'recovery') {
      router.replace('/sign-in/new-password');
      return;
    }
    if (type === 'email_change') {
      close();
      openWhenReady(destination ?? '/dashboard/account');
      return;
    }
    await land(intentFromPath(destination));
  }, [type, tokenHash, params.redirect_to, land, close]);

  useEffect(() => {
    if (!ready || !valid || ask || started.current) return;
    started.current = true;
    void verify();
  }, [ready, valid, ask, verify]);

  if (state === 'failed') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AuthScroll>
          <View style={{ height: space[8] }} />
          <AuthHeading title={t('common.error')} body={t('auth.linkExpired')} />
          <Button
            label={type === 'recovery' ? t('auth.sendResetLink') : t('nav.signIn')}
            onPress={() => router.replace(type === 'recovery' ? '/sign-in/forgot' : '/sign-in')}
          />
          <Button label={t('common.close')} variant="ghost" onPress={close} />
        </AuthScroll>
      </>
    );
  }

  if (ask) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AuthScroll>
          <View style={{ height: space[8] }} />
          <AuthHeading
            title={t('app.auth.switchTitle')}
            body={t('app.auth.switchBody', { email: session?.user.email ?? '' })}
          />
          <Button
            label={t('app.auth.switchContinue')}
            onPress={() => {
              started.current = true;
              void verify();
            }}
          />
          <Button label={t('app.auth.switchCancel')} variant="outline" onPress={close} />
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
