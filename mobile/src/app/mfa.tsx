import { useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslations } from 'use-intl';
import { AuthHeading, AuthScroll } from '~/components/auth/auth-scroll';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { Notice } from '~/components/ui/notice';
import { TextField } from '~/components/ui/text-field';
import { intentFromParams } from '~/features/auth/intent';
import { useCloseFlow, useLand } from '~/features/auth/land';
import { supabase } from '~/lib/supabase';
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
  const params = useLocalSearchParams<{ next?: string; role?: string; confirmed?: string }>();
  const intent = intentFromParams(params);
  const land = useLand();
  const close = useCloseFlow();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function verify() {
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) {
      setError(t('account.mfaCodeInvalid'));
      return;
    }
    setError(null);
    setPending(true);

    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setPending(false);
      setError(t('common.errorBody'));
      return;
    }
    const factor = factors?.totp.find((candidate) => candidate.status === 'verified') ?? factors?.totp[0];
    if (!factor) {
      // Nothing to answer with — removed elsewhere since this session began.
      await land(intent);
      setPending(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: digits });
    if (verifyError) {
      setPending(false);
      setCode('');
      setError(t('account.mfaCodeInvalid'));
      return;
    }
    await land(intent);
    setPending(false);
  }

  async function signOut() {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    close();
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <AuthScroll>
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
        </View>
      </AuthScroll>
    </>
  );
}
