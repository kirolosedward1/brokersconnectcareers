import { useRef, useState, type ReactNode } from 'react';
import { View, type TextInputInstance } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import type { AuthError } from '@supabase/supabase-js';
import { useTranslations } from 'use-intl';
import { Briefcase, MailCheck, RefreshCw, Search } from '~/components/ui/lucide';
import { AuthHeading, AuthScroll, AuthSwitch } from '~/components/auth/auth-scroll';
import { CaptchaStatus, captchaBlocks } from '~/components/auth/captcha-status';
import { PasswordStrength } from '~/components/auth/password-strength';
import { SocialSignIn } from '~/components/auth/social-sign-in';
import { ChoiceCard } from '~/components/ui/choice-card';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { Notice } from '~/components/ui/notice';
import { PasswordField } from '~/components/ui/password-field';
import { InlineLink, LinkLine } from '~/components/ui/inline-link';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { useCaptcha } from '~/features/auth/captcha';
import { useAuthErrorText } from '~/features/auth/errors';
import { confirmationPath, intentFromParams, intentParams, type Role } from '~/features/auth/intent';
import { useLand } from '~/features/auth/land';
import type { ProviderOutcome } from '~/features/auth/providers';
import { track } from '~/lib/analytics';
import { callAction } from '~/lib/api';
import { withAppMarker } from '~/lib/app-marker';
import { env } from '~/lib/env';
import { useErrorFeedback } from '~/lib/haptics';
import { supabase } from '~/lib/supabase';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';
import { livePasswordChecks, PASSWORD_MIN, PASSWORD_RULES } from '~/lib/password-checks';

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
  const params = useLocalSearchParams<{ next?: string; role?: string; email?: string }>();
  const given = intentFromParams(params);
  // The kind of account, asked here when the door did not say (v1.1, the
  // SignUp board) and carried on as the door's would be; onboarding asks it
  // otherwise.
  const [role, setRole] = useState<Role | null>(given.role);
  const intent = { ...given, role: role ?? given.role };
  const land = useLand();
  const errorText = useAuthErrorText();
  const captcha = useCaptcha('sign-up');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  useErrorFeedback(error);
  const [pending, setPending] = useState(false);
  // The return key moves on to the next field, and from the last one signs up, as on sign-in.
  const passwordField = useRef<TextInputInstance>(null);
  const confirmField = useRef<TextInputInstance>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState<'sent' | 'wait' | 'offline' | null>(null);

  // Said under the fields while typing; checked again when sent.
  const live = livePasswordChecks(password, passwordConfirm);

  async function submit() {
    setError(null);
    if (password.length < PASSWORD_MIN) {
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
          // What onboarding starts from: the kind of account and the name, as a provider's would be.
          ...(intent.role || fullName.trim()
            ? { data: { ...(intent.role ? { role: intent.role } : {}), ...(fullName.trim() ? { full_name: fullName.trim() } : {}) } }
            : {}),
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
    // A new account, not an address that already had one (Auth answers those with no identities).
    if (data.user && data.user.identities?.length !== 0) {
      track(intent.role === 'candidate' ? 'candidate_signed_up' : intent.role === 'employer' ? 'employer_signed_up' : 'account_signed_up', {});
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
        {/* The door said nothing: the kind of account, asked here and not again. */}
        {given.role ? null : (
          <View style={{ gap: space[2] }}>
            <Text variant="small" weight="semibold">
              {t('onboarding.roleQuestion')}
            </Text>
            <View accessibilityRole="radiogroup" accessibilityLabel={t('onboarding.roleQuestion')} style={{ gap: space[2] }}>
              <ChoiceCard
                selected={role === 'candidate'}
                onPress={() => setRole('candidate')}
                icon={Search}
                title={t('onboarding.roleCandidate')}
                hint={t('onboarding.roleCandidateHint')}
              />
              <ChoiceCard
                selected={role === 'employer'}
                onPress={() => setRole('employer')}
                icon={Briefcase}
                title={t('onboarding.roleEmployer')}
                hint={t('onboarding.roleEmployerHint')}
              />
            </View>
          </View>
        )}

        <Field label={t('onboarding.fullName')} hint={t('common.optional')}>
          <TextField
            value={fullName}
            onChangeText={setFullName}
            accessibilityLabel={t('onboarding.fullName')}
            placeholder={t('app.auth.fullNamePlaceholder')}
            autoComplete="name"
            textContentType="name"
            maxLength={120}
          />
        </Field>

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
            submitBehavior="submit"
            onSubmitEditing={() => passwordField.current?.focus()}
          />
        </Field>

        <Field label={t('auth.password')} error={live.short ? t('validation.passwordShort') : undefined}>
          <PasswordField
            ref={passwordField}
            value={password}
            onChangeText={setPassword}
            accessibilityLabel={t('auth.password')}
            autoComplete="new-password"
            textContentType="newPassword"
            passwordRules={PASSWORD_RULES}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => confirmField.current?.focus()}
          />
          <PasswordStrength password={password} />
        </Field>

        <Field label={t('auth.passwordConfirm')} error={live.mismatch ? t('validation.passwordMismatch') : undefined}>
          <PasswordField
            ref={confirmField}
            value={passwordConfirm}
            onChangeText={setPasswordConfirm}
            accessibilityLabel={t('auth.passwordConfirm')}
            autoComplete="new-password"
            textContentType="newPassword"
            passwordRules={PASSWORD_RULES}
            returnKeyType="go"
            onSubmitEditing={() => {
              if (!pending && !captchaBlocks(captcha)) void submit();
            }}
          />
        </Field>

        {/* Not said twice: a refusal the field already says stays under the field. */}
        {error && !(live.short && error === t('validation.passwordShort')) && !(live.mismatch && error === t('validation.passwordMismatch')) ? (
          <Notice tone="destructive">{error}</Notice>
        ) : null}

        <CaptchaStatus captcha={captcha} />

        <Button label={t('auth.signUp')} size="lg" loading={pending} disabled={captchaBlocks(captcha)} onPress={submit} />
        {captcha.status === 'checking' && !pending ? (
          <Text variant="caption" tone="mutedForeground" style={{ textAlign: 'center' }}>
            {t('app.auth.captchaChecking')}
          </Text>
        ) : null}

        {/* The website's line: where the address is asked for, the policy that
            says what happens to it. Agreeing is onboarding's checkbox, the one
            step every way in goes through. */}
        <LinkLine>
          {t.rich('auth.signUpNotice', {
            terms: (chunks: ReactNode) => (
              <InlineLink variant="caption" onPress={() => openSitePage('/terms')}>
                {chunks}
              </InlineLink>
            ),
            privacy: (chunks: ReactNode) => (
              <InlineLink variant="caption" onPress={() => openSitePage('/privacy')}>
                {chunks}
              </InlineLink>
            ),
          })}
        </LinkLine>
      </View>

      <AuthSwitch question={t('auth.hasAccount')} action={t('auth.signIn')} onPress={toSignIn} />
    </AuthScroll>
  );
}

function openSitePage(path: '/terms' | '/privacy') {
  WebBrowser.openBrowserAsync(withAppMarker(`${env.siteUrl}${path}`)).catch(() => {});
}
