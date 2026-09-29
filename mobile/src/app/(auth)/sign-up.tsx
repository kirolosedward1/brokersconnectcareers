import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { AuthError } from '@supabase/supabase-js';
import { useTranslations } from 'use-intl';
import { MailCheck, RefreshCw } from '~/components/ui/lucide';
import { AuthHeading, AuthScroll, AuthSwitch } from '~/components/auth/auth-scroll';
import { CaptchaStatus, captchaBlocks } from '~/components/auth/captcha-status';
import { SocialSignIn } from '~/components/auth/social-sign-in';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { useCaptcha } from '~/features/auth/captcha';
import { useAuthErrorText } from '~/features/auth/errors';
import { confirmationPath, intentFromParams, intentParams } from '~/features/auth/intent';
import { useLand } from '~/features/auth/land';
import type { ProviderOutcome } from '~/features/auth/providers';
import { callAction } from '~/lib/api';
import { env } from '~/lib/env';
import { supabase } from '~/lib/supabase';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * Create an account — the website's sign-up, rule for rule: eight characters,
 * typed twice (here, and only here, where a typo would lock the person out of
 * an account they have not used yet), the door's role kept in user metadata,
 * and a confirmation email that comes back to onboarding with the page they
 * were on their way to. The email's link is the website's; on a phone with
 * the app it opens here (auth/confirm), anywhere else on the website, and both
 * do the same thing with it.
 *
 * With email confirmation on there is no session yet, so the screen becomes
 * the website's "check your email", with the spam folder named and a way to
 * have it sent again.
 */
export default function SignUpScreen() {
  const t = useTranslations();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ next?: string; role?: string }>();
  const intent = intentFromParams(params);
  const land = useLand();
  const errorText = useAuthErrorText();
  const captcha = useCaptcha('sign-up');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState<'sent' | 'wait' | 'offline' | null>(null);

  async function submit() {
    setError(null);
    if (password.length < 8) {
      setError(t('validation.passwordShort'));
      return;
    }
    if (password !== passwordConfirm) {
      setError(t('validation.passwordMismatch'));
      return;
    }

    const address = email.trim();
    setPending(true);
    const { data, error: signUpError } = await supabase.auth
      .signUp({
        email: address,
        password,
        options: {
          emailRedirectTo: `${env.siteUrl}${confirmationPath(intent)}`,
          ...(intent.role ? { data: { role: intent.role } } : {}),
          ...(captcha.token ? { captchaToken: captcha.token } : {}),
        },
      })
      // Thrown rather than answered (the phone's storage failing): said, and the button freed.
      .catch((failure: unknown) => ({ data: { session: null, user: null }, error: failure as AuthError }));
    captcha.renew();

    if (signUpError) {
      setPending(false);
      setError(errorText(signUpError));
      void callAction('reportAuthOutcome', { kind: 'sign_up_failed', email: address }).catch(() => null);
      return;
    }
    if (!data.session) {
      setPending(false);
      setSentTo(address);
      return;
    }

    await land(intent).catch(() => setError(t('common.errorBody')));
    setPending(false);
  }

  async function resend() {
    if (!sentTo) return;
    setResent(null);
    setPending(true);
    const result = await callAction('resendConfirmation', {
      email: sentTo,
      redirectTo: confirmationPath(intent),
      ...(captcha.token ? { captchaToken: captcha.token } : {}),
    }).catch(() => null);
    captcha.renew();
    setPending(false);
    // No answer is not "wait a moment": it is offline.
    setResent(result === null ? 'offline' : result.ok ? 'sent' : 'wait');
  }

  async function afterProvider(outcome: ProviderOutcome) {
    if (outcome.ok) {
      await land(intent);
      return;
    }
    if (!outcome.cancelled) setError(errorText(outcome.error));
  }

  const toSignIn = () => router.replace({ pathname: '/sign-in', params: intentParams(intent) });

  if (sentTo) {
    return (
      <AuthScroll>
        <Notice
          tone="success"
          title={t('auth.checkEmailTitle')}
          icon={<MailCheck size={16} color={colors.success} />}
        >
          <View style={{ gap: space[2] }}>
            <Text variant="small">{t('auth.checkEmail')}</Text>
            <Text variant="small" tone="mutedForeground">
              {t('auth.checkEmailSpam')}
            </Text>
          </View>
        </Notice>

        {resent === 'sent' ? (
          <Text variant="small" weight="medium" tone="success">
            {t('auth.resendSent')}
          </Text>
        ) : resent === 'wait' ? (
          <Text variant="small" tone="destructive" accessibilityRole="alert">
            {t('auth.resendWait')}
          </Text>
        ) : resent === 'offline' ? (
          <Text variant="small" tone="destructive" accessibilityRole="alert">
            {t('app.offline.body')}
          </Text>
        ) : null}

        <CaptchaStatus captcha={captcha} />

        <Button
          label={t('auth.resendConfirmation')}
          variant="outline"
          icon={<RefreshCw size={16} color={colors.foreground} />}
          loading={pending}
          disabled={captchaBlocks(captcha)}
          onPress={resend}
        />

        <AuthSwitch action={t('auth.backToSignIn')} onPress={toSignIn} />
      </AuthScroll>
    );
  }

  const title =
    intent.role === 'employer'
      ? t('auth.signUpTitleEmployer')
      : intent.role === 'candidate'
        ? t('auth.signUpTitleCandidate')
        : t('auth.signUpTitle');
  const preselected =
    intent.role === 'employer'
      ? t('auth.preselectedEmployer')
      : intent.role === 'candidate'
        ? t('auth.preselectedCandidate')
        : null;

  return (
    <AuthScroll>
      <AuthHeading title={title} body={preselected} />

      <SocialSignIn mode="sign-up" disabled={pending} onBusy={setPending} onOutcome={afterProvider} />

      <View style={{ gap: space[4] }}>
        <Field label={t('auth.email')}>
          <TextField
            value={email}
            onChangeText={setEmail}
            accessibilityLabel={t('auth.email')}
            ltr
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="username"
          />
        </Field>

        <Field label={t('auth.password')}>
          <TextField
            value={password}
            onChangeText={setPassword}
            accessibilityLabel={t('auth.password')}
            ltr
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            passwordRules="minlength: 8;"
          />
        </Field>

        <Field label={t('auth.passwordConfirm')}>
          <TextField
            value={passwordConfirm}
            onChangeText={setPasswordConfirm}
            accessibilityLabel={t('auth.passwordConfirm')}
            ltr
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            passwordRules="minlength: 8;"
          />
        </Field>

        {error ? <Notice tone="destructive">{error}</Notice> : null}

        <CaptchaStatus captcha={captcha} />

        <Button label={t('auth.signUp')} size="lg" loading={pending} disabled={captchaBlocks(captcha)} onPress={submit} />
        {captcha.status === 'checking' && !pending ? (
          <Text variant="caption" tone="mutedForeground" style={{ textAlign: 'center' }}>
            {t('app.auth.captchaChecking')}
          </Text>
        ) : null}
      </View>

      <AuthSwitch question={t('auth.hasAccount')} action={t('auth.signIn')} onPress={toSignIn} />
    </AuthScroll>
  );
}
