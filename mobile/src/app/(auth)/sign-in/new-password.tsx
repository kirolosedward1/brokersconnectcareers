import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { isAuthRetryableFetchError, type AuthError } from '@supabase/supabase-js';
import { useTranslations } from 'use-intl';
import { Check } from 'lucide-react-native';
import { AuthHeading, AuthScroll } from '~/components/auth/auth-scroll';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { Notice } from '~/components/ui/notice';
import { TextField } from '~/components/ui/text-field';
import { NO_INTENT } from '~/features/auth/intent';
import { useLand } from '~/features/auth/land';
import { callAction } from '~/lib/api';
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
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

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
      setError(
        isAuthRetryableFetchError(updateError)
          ? t('app.offline.body')
          : /session|jwt|expired/i.test(updateError.message)
            ? t('auth.linkExpired')
            : t('common.errorBody'),
      );
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

          <Button label={t('auth.resetPassword')} size="lg" loading={pending} onPress={submit} />
        </View>
      )}
    </AuthScroll>
  );
}
