import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { useTranslations } from 'use-intl';
import { westernDigits } from '@/lib/search/arabic';
import { AuthHeading, AuthScroll } from '~/components/auth/auth-scroll';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { ExternalLink } from '~/components/ui/lucide';
import { Notice } from '~/components/ui/notice';
import { LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { toast } from '~/components/feedback/toast';
import { beginEnrolment, verifyCode, type Enrolment } from '~/features/account/settings';
import { useErrorFeedback } from '~/lib/haptics';
import { supabase } from '~/lib/supabase';
import { useTheme } from '~/theme/provider';
import { corner, font, space } from '~/theme/tokens';

/**
 * Two-step verification set up on the phone — the website's MfaSettings,
 * without the website: an authenticator factor enrolled (an abandoned attempt's
 * unverified one cleared first, as Supabase refuses a second with the same
 * name), added to the authenticator app on this phone through its otpauth://
 * link or by typing the key, and confirmed with its first code. The verify
 * lifts this session to aal2, so the admin console's door (which re-reads the
 * level whenever the session's token changes) opens behind this screen.
 *
 * A QR code is no use here: it would have to be scanned by the phone showing it.
 */
export default function EnrolSecondFactorScreen() {
  const t = useTranslations();
  const { colors } = useTheme();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  useErrorFeedback(error);
  const [pending, setPending] = useState(false);
  const started = useRef(false);

  async function begin(): Promise<string | null> {
    // The Account screen's own steps (features/account/settings.ts): an abandoned attempt's
    // unverified factor cleared, then a new one.
    const { data: existing, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) return isAuthRetryableFetchError(listError) ? t('app.offline.body') : t('common.errorBody');
    if (existing?.totp.some((factor) => factor.status === 'verified')) {
      // Set up already (on another device, or a moment ago): nothing to add.
      router.back();
      return null;
    }
    const fresh = await beginEnrolment();
    if (!fresh) return t('common.errorBody');
    setEnrolment(fresh);
    return null;
  }

  const start = () => {
    setError(null);
    begin()
      .catch(() => t('common.errorBody'))
      .then((problem) => {
        if (problem) setError(problem);
      });
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start();
    // Once, as the screen opens; a failure offers to try again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirm(digits: string): Promise<string | null> {
    if (!enrolment) return null;
    const outcome = await verifyCode(enrolment.factorId, digits);
    if (outcome === 'offline') return t('app.offline.body');
    if (outcome === 'busy') return t('auth.errTooMany');
    if (outcome === 'wrong') {
      setCode('');
      return t('account.mfaCodeInvalid');
    }
    toast.show({ message: t('account.mfaEnabled'), tone: 'success' });
    router.back();
    return null;
  }

  const verify = (typed = code) => {
    // Typed on an Arabic keyboard, the number pad gives Arabic-Indic digits.
    const digits = westernDigits(typed).replace(/\D/g, '');
    if (digits.length !== 6) {
      setError(t('account.mfaCodeInvalid'));
      return;
    }
    if (pending) return;
    setError(null);
    setPending(true);
    confirm(digits)
      .catch(() => t('common.errorBody'))
      .then((problem) => {
        setPending(false);
        if (problem) setError(problem);
      });
  };

  return (
    <>
      <Stack.Screen options={{ title: t('account.mfaSetup') }} />
      <AuthScroll bare>
        <View style={{ height: space[6] }} />
        <AuthHeading title={t('account.mfaSetup')} body={t('app.auth.mfaEnrolLede')} />
        {!enrolment ? (
          error ? (
            <View style={{ gap: space[3] }}>
              <Notice tone="destructive">{error}</Notice>
              <Button label={t('common.retry')} onPress={start} />
            </View>
          ) : (
            <LoadingState spinner />
          )
        ) : (
          <View style={{ gap: space[4] }}>
            <Button
              label={t('app.auth.mfaEnrolOpenApp')}
              size="lg"
              icon={<ExternalLink size={18} color={colors.primaryForeground} />}
              onPress={() => Linking.openURL(enrolment.uri).catch(() => setError(t('app.auth.mfaEnrolNoApp')))}
            />
            <Field label={t('account.mfaSecret')}>
              <View style={{ padding: space[3], ...corner('lg'), borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
                <Text selectable style={{ fontFamily: font.medium, letterSpacing: 1, writingDirection: 'ltr', textAlign: 'center' }}>
                  {enrolment.secret}
                </Text>
              </View>
            </Field>
            <Field label={t('account.mfaCode')}>
              <TextField
                value={code}
                onChangeText={(typed) => {
                  setCode(typed);
                  if (westernDigits(typed).replace(/\D/g, '').length === 6) verify(typed);
                }}
                accessibilityLabel={t('account.mfaCode')}
                ltr
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={6}
                onSubmitEditing={() => verify()}
              />
            </Field>
            {error ? <Notice tone="destructive">{error}</Notice> : null}
            <Button label={t('account.mfaVerify')} size="lg" loading={pending} onPress={() => verify()} />
            <Button label={t('common.cancel')} variant="ghost" disabled={pending} onPress={() => router.back()} />
          </View>
        )}
      </AuthScroll>
    </>
  );
}
