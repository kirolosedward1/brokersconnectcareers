import { useState } from 'react';
import { View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { useTranslations } from 'use-intl';
import { Mail } from 'lucide-react-native';
import { AuthHeading, AuthScroll, AuthSwitch } from '~/components/auth/auth-scroll';
import { CaptchaStatus, captchaBlocks } from '~/components/auth/captcha-status';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { Notice } from '~/components/ui/notice';
import { TextField } from '~/components/ui/text-field';
import { useCaptcha } from '~/features/auth/captcha';
import { callAction } from '~/lib/api';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * Ask for a reset link — the website's form, through the website's action
 * (requestPasswordReset), which limits requests per address and per network
 * and answers the same whether or not the address has an account. So does
 * this screen: "if that email is registered", never "no account with that
 * email", which would tell anyone with a list which addresses are consultants
 * looking for work. The one failure said out loud is a request that never
 * left the phone — that says nothing about the address.
 *
 * The link in the email is the website's /auth/confirm; on this phone it
 * opens the app, which verifies it and asks for the new password.
 */
export default function ForgotPasswordScreen() {
  const t = useTranslations();
  const { colors } = useTheme();
  const captcha = useCaptcha('reset');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<'sent' | 'wait' | 'offline' | 'invalid' | null>(null);
  const navigation = useNavigation();
  // Reached by replacing another screen (an expired link), this is the sheet's
  // only screen, and going back would close the sheet instead of signing in.
  const backToSignIn = () => ((navigation.getState()?.index ?? 0) > 0 ? router.back() : router.replace('/sign-in'));

  async function submit() {
    const address = email.trim();
    if (!address) return;
    setOutcome(null);
    setPending(true);
    const result = await callAction('requestPasswordReset', {
      email: address,
      ...(captcha.token ? { captchaToken: captcha.token } : {}),
    }).catch(() => null);
    captcha.renew();
    setPending(false);

    if (!result) {
      setOutcome('offline');
      return;
    }
    // A hashed address and a hashed client, so a run of resets against one
    // inbox is visible to whoever is watching; nothing about the address is kept.
    void callAction('reportAuthOutcome', { kind: 'reset_requested', email: address }).catch(() => null);
    // Every other answer reads "sent", so nobody learns which addresses have accounts;
    // an address that is not one is said to be that, not that a link is on its way.
    setOutcome(!result.ok && result.error === 'wait' ? 'wait' : !result.ok && result.error === 'invalid' ? 'invalid' : 'sent');
  }

  if (outcome === 'sent') {
    return (
      <AuthScroll>
        <AuthHeading title={t('auth.forgotTitle')} />
        <Notice tone="success">{t('auth.resetSent')}</Notice>
        <Button label={t('auth.backToSignIn')} variant="outline" onPress={backToSignIn} />
      </AuthScroll>
    );
  }

  return (
    <AuthScroll>
      <AuthHeading title={t('auth.forgotTitle')} body={t('auth.forgotBody')} />

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
            returnKeyType="send"
            onSubmitEditing={() => {
              if (!pending && !captchaBlocks(captcha)) void submit();
            }}
          />
        </Field>

        <CaptchaStatus captcha={captcha} />

        {outcome === 'wait' ? (
          <Notice tone="destructive">{t('auth.resendWait')}</Notice>
        ) : outcome === 'offline' ? (
          <Notice tone="destructive">{t('app.offline.body')}</Notice>
        ) : outcome === 'invalid' ? (
          <Notice tone="destructive">{t('validation.invalidEmail')}</Notice>
        ) : null}

        <Button
          label={t('auth.sendResetLink')}
          icon={<Mail size={16} color={colors.primaryForeground} />}
          loading={pending}
          disabled={!email.trim() || captchaBlocks(captcha)}
          onPress={submit}
        />
      </View>

      <AuthSwitch action={t('auth.backToSignIn')} onPress={backToSignIn} />
    </AuthScroll>
  );
}
