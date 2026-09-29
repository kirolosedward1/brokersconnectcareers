import { useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import { Check, KeyRound, Mail } from 'lucide-react-native';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Field } from '~/components/ui/field';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { useAuthErrorText } from '~/features/auth/errors';
import { callAction } from '~/lib/api';
import { supabase } from '~/lib/supabase';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/** A shape check before anything is sent; Supabase has the last word. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Change the email address — the website's CredentialsSettings, through
 * Supabase Auth against this session as the website's browser code does.
 * Nothing moves until the new address is confirmed (and the old one, when
 * the project asks for both), which is what stops a borrowed phone walking
 * off with the account; the confirmation link opens the app.
 */
export function EmailSettings({ email }: { email: string }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const authError = useAuthErrorText();
  const [next, setNext] = useState(email);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  const save = async () => {
    const address = next.trim();
    setError(null);
    setSent(false);
    if (!address || address === email) return;
    if (!EMAIL.test(address)) {
      setError(t('validation.invalidEmail'));
      return;
    }
    setPending(true);
    const { error: refused } = await supabase.auth.updateUser({ email: address });
    setPending(false);
    if (refused) setError(authError(refused));
    else setSent(true);
  };

  return (
    <Card style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Text weight="semibold" accessibilityRole="header">
          {t('account.emailTitle')}
        </Text>
        <Text variant="small" tone="mutedForeground">
          {t('account.emailBody')}
        </Text>
      </View>
      <Field label={t('account.newEmail')} error={error}>
        <TextField
          value={next}
          onChangeText={setNext}
          accessibilityLabel={t('account.newEmail')}
          ltr
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
          autoComplete="email"
        />
      </Field>
      {sent ? <Notice tone="success">{t('account.emailPending')}</Notice> : null}
      <View style={{ alignItems: 'flex-start' }}>
        <Button
          label={t('common.save')}
          icon={<Mail size={16} color={colors.primaryForeground} />}
          loading={pending}
          onPress={save}
        />
      </View>
    </Card>
  );
}

/**
 * Change the password — for an account that has one. Every other session
 * ends afterwards: a password is changed because the old one may be known to
 * somebody who is signed in elsewhere right now. This phone stays signed in,
 * as the copy promises, and the account is told by email (best effort, after
 * the change, never instead of it).
 */
export function PasswordSettings({ provider }: { provider: 'email' | 'google' | 'apple' }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const authError = useAuthErrorText();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  const hasPassword = provider === 'email';

  const save = async () => {
    setDone(false);
    setError(null);
    if (password.length < 8) {
      setError(t('validation.passwordShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('validation.passwordMismatch'));
      return;
    }
    setPending(true);
    const { error: refused } = await supabase.auth.updateUser({ password });
    if (refused) {
      setPending(false);
      setError(authError(refused));
      return;
    }
    setPassword('');
    setConfirm('');
    setDone(true);
    await supabase.auth.signOut({ scope: 'others' }).catch(() => {});
    setPending(false);
    void callAction('announcePasswordChange').catch(() => {});
  };

  return (
    <Card style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Text weight="semibold" accessibilityRole="header">
          {t('account.passwordTitle')}
        </Text>
        <Text variant="small" tone="mutedForeground">
          {hasPassword
            ? t('account.passwordBody')
            : provider === 'apple'
              ? t('app.account.oauthOnlyApple')
              : t('account.oauthOnly')}
        </Text>
      </View>

      {hasPassword ? (
        <>
          <Field label={t('account.newPassword')}>
            <TextField
              value={password}
              onChangeText={setPassword}
              accessibilityLabel={t('account.newPassword')}
              ltr
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
              autoCapitalize="none"
            />
          </Field>
          <Field label={t('auth.passwordConfirm')} error={error}>
            <TextField
              value={confirm}
              onChangeText={setConfirm}
              accessibilityLabel={t('auth.passwordConfirm')}
              ltr
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
              autoCapitalize="none"
            />
          </Field>
          {done ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }} accessibilityLiveRegion="polite">
              <Check size={16} color={colors.success} />
              <Text variant="small" weight="medium" tone="success">
                {t('account.passwordSaved')}
              </Text>
            </View>
          ) : null}
          <View style={{ alignItems: 'flex-start' }}>
            <Button
              label={t('common.save')}
              icon={<KeyRound size={16} color={colors.primaryForeground} />}
              loading={pending}
              onPress={save}
            />
          </View>
        </>
      ) : null}
    </Card>
  );
}
