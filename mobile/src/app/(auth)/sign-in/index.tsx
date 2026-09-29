import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslations } from 'use-intl';
import { RefreshCw } from 'lucide-react-native';
import type { AuthFriction } from '@/lib/mobile-api/contract';
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
import { supabase } from '~/lib/supabase';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * Sign in — the website's form (src/components/auth/auth-form.tsx), with the
 * same rules in the same order: a pause the server can ask for after repeated
 * failures, eight characters before anything is sent, the captcha token when
 * the project asks for one, GoTrue's refusal in the reader's language, and a
 * way to have the confirmation email sent again when that is what stands in
 * the way. The server hears about each failure (reportAuthOutcome) and says
 * how long to pause — advice, not a gate: GoTrue's own limits are the gate.
 */
export default function SignInScreen() {
  const t = useTranslations();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ next?: string; role?: string }>();
  const intent = intentFromParams(params);
  const land = useLand();
  const errorText = useAuthErrorText();
  const captcha = useCaptcha('sign-in');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resent, setResent] = useState<'sent' | 'wait' | null>(null);
  const [pausedUntil, setPausedUntil] = useState(0);

  const busy = pending;

  async function submit() {
    setError(null);
    setResent(null);

    const wait = Math.ceil((pausedUntil - Date.now()) / 1000);
    if (wait > 0) {
      setError(t('auth.slowDown', { seconds: wait }));
      return;
    }
    if (password.length < 8) {
      setError(t('validation.passwordShort'));
      return;
    }

    const address = email.trim();
    setPending(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: address,
      password,
      options: captcha.token ? { captchaToken: captcha.token } : undefined,
    });
    // Spent either way: Supabase takes one token per attempt.
    captcha.renew();

    if (signInError) {
      setPending(false);
      setError(errorText(signInError));
      setUnconfirmed(signInError.code === 'email_not_confirmed' || /email not confirmed/i.test(signInError.message));
      const friction: AuthFriction | null = await callAction('reportAuthOutcome', {
        kind: 'sign_in_failed',
        email: address,
      }).catch(() => null);
      if (friction?.pause) setPausedUntil(Date.now() + friction.pause * 1000);
      return;
    }

    await land(intent);
    setPending(false);
  }

  async function resend() {
    setResent(null);
    setPending(true);
    const result = await callAction('resendConfirmation', {
      email: email.trim(),
      redirectTo: confirmationPath(intent),
      ...(captcha.token ? { captchaToken: captcha.token } : {}),
    }).catch(() => null);
    captcha.renew();
    setPending(false);
    setResent(result?.ok ? 'sent' : 'wait');
  }

  async function afterProvider(outcome: ProviderOutcome) {
    if (outcome.ok) {
      await land(intent);
      return;
    }
    if (!outcome.cancelled) setError(errorText(outcome.error));
  }

  return (
    <AuthScroll>
      <AuthHeading title={intent.role === 'employer' ? t('auth.signInTitleEmployer') : t('auth.signInTitle')} />

      <SocialSignIn mode="sign-in" disabled={busy} onBusy={setPending} onOutcome={afterProvider} />

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
            returnKeyType="next"
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
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => {
              if (!busy && !captchaBlocks(captcha)) void submit();
            }}
          />
        </Field>

        <Text
          variant="small"
          weight="medium"
          tone="primary"
          accessibilityRole="link"
          onPress={() => router.push('/sign-in/forgot')}
          suppressHighlighting
        >
          {t('auth.forgotPassword')}
        </Text>

        {error ? <Notice tone="destructive">{error}</Notice> : null}

        {error && unconfirmed ? (
          <View style={{ gap: space[2] }}>
            {resent === 'sent' ? (
              <Text variant="small" weight="medium" tone="success">
                {t('auth.resendSent')}
              </Text>
            ) : resent === 'wait' ? (
              <Text variant="small" tone="destructive">
                {t('auth.resendWait')}
              </Text>
            ) : null}
            <Button
              label={t('auth.resendConfirmation')}
              variant="outline"
              icon={<RefreshCw size={16} color={colors.foreground} />}
              disabled={busy || !email.trim() || captchaBlocks(captcha)}
              onPress={resend}
            />
          </View>
        ) : null}

        <CaptchaStatus captcha={captcha} />

        <Button
          label={t('auth.signIn')}
          size="lg"
          loading={busy}
          disabled={captchaBlocks(captcha)}
          onPress={submit}
        />
        {captcha.status === 'checking' && !busy ? (
          <Text variant="caption" tone="mutedForeground" style={{ textAlign: 'center' }}>
            {t('app.auth.captchaChecking')}
          </Text>
        ) : null}
      </View>

      <AuthSwitch
        question={t('auth.noAccount')}
        action={t('auth.signUp')}
        onPress={() => router.replace({ pathname: '/sign-up', params: intentParams(intent) })}
      />
    </AuthScroll>
  );
}
