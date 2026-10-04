import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { useTranslations } from 'use-intl';
import { OPERATOR } from '@/lib/business';
import { westernDigits } from '@/lib/search/arabic';
import { AuthHeading, AuthScroll } from '~/components/auth/auth-scroll';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { intentFromParams } from '~/features/auth/intent';
import { useCloseFlow, useLand } from '~/features/auth/land';
import { useMobileConfig } from '~/features/config';
import { signOutHere } from '~/features/push/device';
import { supabase } from '~/lib/supabase';
import { useHoldBack } from '~/lib/use-hold-back';
import { space } from '~/theme/tokens';

/**
 * The code from the authenticator app, for an account that has one — asked
 * right after the password (or Apple, or Google), before anything else opens.
 *
 * The website asks for it only where the database demands it (the admin
 * console); an account holder who turned it on expects it at every sign-in,
 * so the app asks every time a session starts at aal1 on an account that can
 * reach aal2. The way out, for someone without the phone that holds the
 * codes, is to sign out — nothing else in the app opens until then.
 */
export default function SecondFactorScreen() {
  const t = useTranslations();
  const config = useMobileConfig();
  const supportEmail = config.data?.supportEmail || OPERATOR.email;
  const params = useLocalSearchParams<{ next?: string; role?: string; confirmed?: string }>();
  const intent = intentFromParams(params);
  const land = useLand();
  const close = useCloseFlow();
  useHoldBack();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** What went wrong, in words, or null once through. */
  async function answer(digits: string): Promise<string | null> {
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) return isAuthRetryableFetchError(listError) ? t('app.offline.body') : t('common.errorBody');
    const factor = factors?.totp.find((candidate) => candidate.status === 'verified') ?? factors?.totp[0];
    if (!factor) {
      // Nothing to answer with — removed elsewhere since this session began.
      // The session still names it until it is refreshed, and landing on it
      // brought this screen straight back, over and over.
      await supabase.auth.refreshSession();
      await land(intent);
      return null;
    }

    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: digits });
    if (verifyError) {
      // No answer is not a wrong code: the code stays for another try.
      if (isAuthRetryableFetchError(verifyError)) return t('app.offline.body');
      setCode('');
      return t('account.mfaCodeInvalid');
    }
    await land(intent);
    return null;
  }

  const verify = () => {
    // Typed on an Arabic keyboard, the number pad gives Arabic-Indic digits.
    const digits = westernDigits(code).replace(/\D/g, '');
    if (digits.length !== 6) {
      setError(t('account.mfaCodeInvalid'));
      return;
    }
    if (pending) return;
    setError(null);
    setPending(true);
    answer(digits)
      .catch(() => t('common.errorBody'))
      .then((problem) => {
        setPending(false);
        if (problem) setError(problem);
      });
  };

  const signOut = () => {
    setPending(true);
    signOutHere().then(() => {
      setPending(false);
      close();
    });
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <AuthScroll bare>
        <View style={{ height: space[8] }} />
        <AuthHeading title={t('account.mfaTitle')} body={t('account.mfaChallengeBody')} />
        <View style={{ gap: space[4] }}>
          <Field label={t('account.mfaCode')}>
            <TextField
              value={code}
              onChangeText={setCode}
              accessibilityLabel={t('account.mfaCode')}
              ltr
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              onSubmitEditing={verify}
            />
          </Field>
          {error ? <Notice tone="destructive">{error}</Notice> : null}
          <Button label={t('account.mfaVerify')} size="lg" loading={pending} onPress={verify} />
          <Button label={t('app.auth.mfaSignOut')} variant="ghost" disabled={pending} onPress={signOut} />
          {/* Without the phone there is no code, and nothing of the account
              opens without one: the way back is a person. */}
          <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center' }}>
            {t('app.auth.mfaLost')}
          </Text>
          <Button
            label={`${t('app.account.contact')} · ${supportEmail}`}
            variant="ghost"
            size="sm"
            onPress={() => Linking.openURL(`mailto:${supportEmail}`).catch(() => {})}
          />
        </View>
      </AuthScroll>
    </>
  );
}
