import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { isAuthRetryableFetchError, type Session, type User } from '@supabase/supabase-js';
import { useTranslations } from 'use-intl';
import { asConfirmType, confirmDestination, isTokenHash } from '@/lib/auth/confirm-link';
import { AuthHeading, AuthScroll } from '~/components/auth/auth-scroll';
import { Button } from '~/components/ui/button';
import { LoadingState } from '~/components/ui/states';
import { intentFromPath, intentParams } from '~/features/auth/intent';
import { useCloseFlow, useLand } from '~/features/auth/land';
import { checkLink } from '~/features/auth/verify-link';
import { env } from '~/lib/env';
import { openWhenReady } from '~/lib/open-path';
import { storedSession, useSession } from '~/lib/session';
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
 * Tapping a link is the person asking for it, so it is checked at once — the
 * website's extra "Continue" step exists for mail scanners, which do not open
 * apps. Checked, not yet taken (verify-link.ts): the account it belongs to is
 * known first. Nobody signed in here, or that same account: it is taken. Some
 * other account signed in: the person is asked, naming both, since going on
 * signs theirs out — whatever kind of link it is, a new address included,
 * which anyone can send for an account of their own.
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
  const destination = type ? confirmDestination(type, params.redirect_to ?? null, env.siteUrl) : null;

  // 'offline': no answer — the link may well still be good, so it is not called expired.
  const [state, setState] = useState<'idle' | 'verifying' | 'failed' | 'offline'>(valid ? 'idle' : 'failed');
  // The link's own account, checked and waiting for the person to say whether to switch to it.
  const [other, setOther] = useState<Session | null>(null);
  // A link that failed for somebody signed in: their account as the server has it now (accountNow).
  const [account, setAccount] = useState<User | null>(null);
  // Checked, but taking it into the app had no answer: tried again with the same session.
  const checked = useRef<Session | null>(null);
  const started = useRef(false);

  const go = useCallback(async () => {
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
  }, [type, destination, land, close]);

  /** The link's session made this phone's, then on to where the link leads. */
  const take = useCallback(
    async (linked: Session) => {
      setOther(null);
      setState('verifying');
      const { error } = await supabase.auth
        .setSession({ access_token: linked.access_token, refresh_token: linked.refresh_token })
        .catch((failure: unknown) => ({ error: failure }));
      if (error) {
        checked.current = linked;
        setState(isAuthRetryableFetchError(error) ? 'offline' : 'failed');
        return;
      }
      checked.current = null;
      await go();
    },
    [go],
  );

  const verify = useCallback(async () => {
    if (!type || !tokenHash) return;
    if (checked.current) {
      await take(checked.current);
      return;
    }
    setState('verifying');
    const result = await checkLink(type, tokenHash);
    if (result.kind === 'error') {
      if (isAuthRetryableFetchError(result.error)) {
        setState('offline');
        return;
      }
      setAccount(await accountNow());
      setState('failed');
      return;
    }
    if (result.kind === 'accepted') {
      // Taken with no one to sign in (the first of an email change's two
      // links): nothing changes on this phone.
      await go();
      return;
    }
    // Who is signed in here, as the phone has it: supabase-js answers nobody
    // while a token that has run out cannot be refreshed (no connection, a
    // 503, the app's own hold after a 429) — and the link would be taken
    // over an account the app still shows, without a word.
    const current = await storedSession();
    if (current && current.user.id !== result.session.user.id) {
      setState('idle');
      setOther(result.session);
      return;
    }
    await take(result.session);
  }, [type, tokenHash, take, go]);

  useEffect(() => {
    if (!ready || !valid || started.current) return;
    started.current = true;
    void verify();
  }, [ready, valid, verify]);

  if (state === 'offline') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AuthScroll bare>
          <View style={{ height: space[8] }} />
          <AuthHeading title={t('app.offline.title')} body={t('app.offline.body')} />
          <Button label={t('common.retry')} onPress={() => void verify()} />
          <Button label={t('common.close')} variant="ghost" onPress={() => close()} />
        </AuthScroll>
      </>
    );
  }

  if (state === 'failed') {
    // Somebody is signed in here, so no sign-in to offer, and the account is
    // named: the link may have been for another of the person's. A
    // confirmation, or a new address that went through: most often the
    // account's own link opened again, and nothing to do. A reset, or a new
    // address still waiting (new_email, as the server has it: accountNow), is
    // left to do, and Sign-in and security is where, with no link needed.
    if (session) {
      const signedIn = account ?? session.user;
      const email = signedIn.email ?? '';
      const unfinished = type === 'recovery' || (type === 'email_change' && Boolean(signedIn.new_email));
      return (
        <>
          <Stack.Screen options={{ headerShown: false }} />
          <AuthScroll bare>
            <View style={{ height: space[8] }} />
            <AuthHeading
              title={t('app.auth.linkUsedTitle')}
              body={
                type === 'recovery'
                  ? t('app.auth.resetLinkFailed', { email })
                  : unfinished
                    ? t('app.auth.emailChangeLinkFailed', { email })
                    : t('app.auth.linkUsedBody', { email })
              }
            />
            {unfinished ? (
              <Button
                label={t('app.account.security')}
                onPress={() => {
                  close();
                  openWhenReady('/account/security');
                }}
              />
            ) : null}
            <Button label={t('common.close')} variant={unfinished ? 'ghost' : undefined} onPress={() => close()} />
          </AuthScroll>
        </>
      );
    }
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AuthScroll bare>
          <View style={{ height: space[8] }} />
          <AuthHeading title={t('common.error')} body={t('auth.linkExpired')} />
          <Button
            label={type === 'recovery' ? t('auth.sendResetLink') : t('nav.signIn')}
            onPress={() =>
              type === 'recovery'
                ? router.replace('/sign-in/forgot')
                : // Signing in instead still goes where the link was going.
                  router.replace({ pathname: '/sign-in', params: intentParams(intentFromPath(destination)) })
            }
          />
          <Button label={t('common.close')} variant="ghost" onPress={() => close()} />
        </AuthScroll>
      </>
    );
  }

  if (other) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AuthScroll bare>
          <View style={{ height: space[8] }} />
          <AuthHeading
            title={t('app.auth.switchTitle')}
            body={t('app.auth.switchBody', { email: session?.user.email ?? '', other: other.user.email ?? '' })}
          />
          <Button label={t('app.auth.switchContinue')} onPress={() => void take(other)} />
          <Button label={t('app.auth.switchCancel')} variant="outline" onPress={() => close()} />
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

/**
 * The account signed in here as the auth server has it now. The one this
 * phone stored is only renewed by a sign-in, a change made here or the hourly
 * refresh, so an address change asked for, or finished, on another device is
 * not in it, and a failed link would be explained from the wrong side of it.
 * Null — the stored one is used — when nobody is signed in, or the server has
 * not answered within ten seconds.
 */
function accountNow(): Promise<User | null> {
  return new Promise((resolve) => {
    const late = setTimeout(() => resolve(null), 10_000);
    supabase.auth
      .getUser()
      .then(({ data, error }) => (error ? null : data.user))
      .catch(() => null)
      .then((user) => {
        clearTimeout(late);
        resolve(user);
      });
  });
}
