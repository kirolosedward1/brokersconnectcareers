import { useAuthErrorText } from '~/features/auth/errors';
import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';
import { router } from 'expo-router';
import { isAuthRetryableFetchError, type AuthError } from '@supabase/supabase-js';
import { useTranslations } from 'use-intl';
import { passwordRefusal } from '@/lib/auth/errors';
import { Check } from '~/components/ui/lucide';
import { AuthHeading, AuthScroll } from '~/components/auth/auth-scroll';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { Notice } from '~/components/ui/notice';
import { PasswordField } from '~/components/ui/password-field';
import { NO_INTENT } from '~/features/auth/intent';
import { useLand } from '~/features/auth/land';
import { callAction } from '~/lib/api';
import { useErrorFeedback } from '~/lib/haptics';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * Set the new password, on the session the reset link has just made — the
 * website's form: typed twice, eight characters, every other session ended
 * (the account was, by the person's own account, out of their control), and
 * the security email the website sends for a password change. Without a
 * session the link was spent or expired, and the answer is a new one.
 */
export default function NewPasswordScreen() {
  const t = useTranslations();
  const { colors } = useTheme();
  const { ready, session } = useSession();
  const land = useLand();
  const authError = useAuthErrorText();
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  useErrorFeedback(error);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  // The return key moves on to the second password, and from there sets it.
  const confirmField = useRef<TextInput>(null);

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

    setPending(true);
    const { error: updateError } = await supabase.auth
      .updateUser({ password })
      // Thrown rather than answered (the phone's storage failing): said, and the button freed.
      .catch((failure: unknown) => ({ error: failure as AuthError }));
    if (updateError) {
      setPending(false);
      const refusal = isAuthRetryableFetchError(updateError) ? null : passwordRefusal(updateError);
      // An authenticator on the account: its code, then back to this form.
      if (refusal === 'second_factor') {
        router.replace({ pathname: '/mfa', params: { then: 'new-password' } });
        return;
      }
      // GoTrue's refusals in the reader's words (the same password again, one
      // too weak): they were all "something went wrong", with nothing to change.
      setError(refusal === 'session' ? t('auth.linkExpired') : authError(updateError));
      return;
    }

    setDone(true);
    await supabase.auth.signOut({ scope: 'others' }).catch(() => {});
    await callAction('announcePasswordChange').catch(() => null);
    await land(NO_INTENT).catch(() => setError(t('common.errorBody')));
    setPending(false);
  }

  if (ready && !session && !done) {
    return (
      <AuthScroll>
        <AuthHeading title={t('auth.newPasswordTitle')} body={t('auth.linkExpired')} />
        <Button label={t('auth.sendResetLink')} onPress={() => router.replace('/sign-in/forgot')} />
      </AuthScroll>
    );
  }

  return (
    <AuthScroll>
      <AuthHeading title={t('auth.newPasswordTitle')} body={done ? null : t('auth.newPasswordBody')} />

      {done ? (
        <Notice tone="success" title={t('auth.passwordUpdated')} icon={<Check size={16} color={colors.success} />} />
      ) : (
        <View style={{ gap: space[4] }}>
          <Field label={t('auth.password')}>
            <PasswordField
              value={password}
              onChangeText={setPassword}
              accessibilityLabel={t('auth.password')}
              autoComplete="new-password"
              textContentType="newPassword"
              passwordRules="minlength: 8;"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => confirmField.current?.focus()}
            />
          </Field>
          <Field label={t('auth.passwordConfirm')}>
            <PasswordField
              ref={confirmField}
              value={passwordConfirm}
              onChangeText={setPasswordConfirm}
              accessibilityLabel={t('auth.passwordConfirm')}
              autoComplete="new-password"
              textContentType="newPassword"
              passwordRules="minlength: 8;"
              returnKeyType="go"
              onSubmitEditing={() => {
                if (!pending) void submit();
              }}
            />
          </Field>

          {error ? <Notice tone="destructive">{error}</Notice> : null}

          <Button label={t('auth.resetPassword')} size="lg" loading={pending} onPress={submit} />
        </View>
      )}
    </AuthScroll>
  );
}
