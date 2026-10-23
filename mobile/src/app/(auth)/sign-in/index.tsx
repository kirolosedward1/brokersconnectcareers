import { useRef, useState } from 'react';
import { View, type TextInput, type TextInputInstance } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { AuthError } from '@supabase/supabase-js';
import { useTranslations } from 'use-intl';
import { Mail, RefreshCw } from '~/components/ui/lucide';
import type { AuthFriction } from '@/lib/mobile-api/contract';
import { AuthHeading, AuthScroll, AuthSwitch } from '~/components/auth/auth-scroll';
import { CaptchaStatus, captchaBlocks } from '~/components/auth/captcha-status';
import { SocialSignIn, useSocialProviders } from '~/components/auth/social-sign-in';
import { Appear } from '~/components/motion/appear';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { Notice } from '~/components/ui/notice';
import { PasswordField } from '~/components/ui/password-field';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { TextLink } from '~/components/ui/text-link';
import { useCaptcha } from '~/features/auth/captcha';
import { useAuthErrorText } from '~/features/auth/errors';
import { confirmationPath, intentFromParams, intentParams } from '~/features/auth/intent';
import { useLand } from '~/features/auth/land';
import type { ProviderOutcome } from '~/features/auth/providers';
import { callAction } from '~/lib/api';
import { useErrorFeedback } from '~/lib/haptics';
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
 *
 * The ways in come first, one button each: Apple's and Google's where they are
 * offered, and "Continue with email", which opens the email and password
 * underneath them in their place (and "Other ways to sign in" goes back).
 * With no one-tap way offered, the form is the page from the start.
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
  useErrorFeedback(error);
  const [pending, setPending] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resent, setResent] = useState<'sent' | 'wait' | 'offline' | null>(null);
  const passwordField = useRef<TextInputInstance>(null);
  const [pausedUntil, setPausedUntil] = useState(0);
  const providers = useSocialProviders();
  const oneTap = providers.apple || providers.google;
  const [withEmail, setWithEmail] = useState(false);
  // The form at once when there is no other way in; otherwise behind "Continue with email".
  // Once shown, it stays: the config answering late (a retry, the phone back online) does
  // not swap it for buttons under the reader's typing.
  const [formKept, setFormKept] = useState(false);
  const showForm = withEmail || formKept || (providers.settled && !oneTap);
  if (showForm && !formKept) setFormKept(true);

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
    const { error: signInError } = await supabase.auth
      .signInWithPassword({
        email: address,
        password,
        options: captcha.token ? { captchaToken: captcha.token } : undefined,
      })
      // Thrown rather than answered (the phone's storage failing): said, and the button freed.
      .catch((failure: unknown) => ({ error: failure as AuthError }));
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

    await land(intent).catch(() => setError(t('common.errorBody')));
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

  return (
    <AuthScroll>
      <AuthHeading title={intent.role === 'employer' ? t('auth.signInTitleEmployer') : t('auth.signInTitle')} />

      {showForm ? (
        <Appear style={{ gap: space[4] }}>
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
              // Asked for: the email goes in straight away. Shown from the start: the keyboard waits to be asked.
              autoFocus={withEmail}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordField.current?.focus()}
            />
          </Field>

          <Field label={t('auth.password')}>
            <PasswordField
              ref={passwordField}
              value={password}
              onChangeText={setPassword}
              accessibilityLabel={t('auth.password')}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => {
                if (!busy && !captchaBlocks(captcha)) void submit();
              }}
            />
          </Field>

          <TextLink label={t('auth.forgotPassword')} onPress={() => router.push('/sign-in/forgot')} />

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
              ) : resent === 'offline' ? (
                <Text variant="small" tone="destructive">
                  {t('app.offline.body')}
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

          {oneTap ? (
            <Text
              variant="small"
              weight="medium"
              tone="primary"
              accessibilityRole="button"
              onPress={() => {
                setError(null);
                setWithEmail(false);
                setFormKept(false);
              }}
              suppressHighlighting
              // A finger's height, though the words are small.
              style={{ textAlign: 'center', paddingVertical: space[3] }}
            >
              {t('app.auth.otherWays')}
            </Text>
          ) : null}
        </Appear>
      ) : (
        <View style={{ gap: space[4] }}>
          <SocialSignIn mode="sign-in" separator={false} disabled={busy} onBusy={setPending} onOutcome={afterProvider}>
            <Button
              label={t('app.auth.continueWithEmail')}
              variant="outline"
              size="lg"
              icon={<Mail size={20} color={colors.foreground} />}
              disabled={busy}
              onPress={() => {
                setError(null);
                setWithEmail(true);
              }}
            />
          </SocialSignIn>
          {error ? <Notice tone="destructive">{error}</Notice> : null}
        </View>
      )}

      <AuthSwitch
        question={t('auth.noAccount')}
        action={t('auth.signUp')}
        onPress={() => router.replace({ pathname: '/sign-up', params: intentParams(intent) })}
      />
    </AuthScroll>
  );
}
