import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'use-intl';
import { Check, ExternalLink, ShieldCheck, ShieldOff } from '~/components/ui/lucide';
import { westernDigits } from '@/lib/search/arabic';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Field } from '~/components/ui/field';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import {
  beginEnrolment,
  removeSecondFactor,
  useSecondFactor,
  verifyCode,
  type Enrolment,
} from '~/features/account/settings';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';

/**
 * Two-step verification with an authenticator app — the website's
 * MfaSettings, over Supabase's TOTP against this session. Nothing set up:
 * offer it. Being set up: on a phone the authenticator is usually on the same
 * phone, so the key opens in it directly (otpauth://), with the QR code for
 * one on another device and the key to type by hand; then the first code.
 * Set up and proven: say so, and offer to turn it off — which Supabase allows
 * only from a session that has proved it.
 */
export function TwoFactorSettings() {
  const t = useTranslations();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const state = useSecondFactor();

  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [noApp, setNoApp] = useState(false);
  const [pending, setPending] = useState(false);

  // Resolves once the state has been read again, so nothing in between is drawn.
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['mfa'] });

  const begin = async () => {
    setError(null);
    setPending(true);
    const started = await beginEnrolment().catch(() => null);
    setPending(false);
    if (!started) setError(t('common.errorBody'));
    else setEnrolment(started);
  };

  const verify = async () => {
    // Typed on an Arabic keyboard, the number pad gives Arabic-Indic digits.
    const digits = westernDigits(code).replace(/\s+/g, '');
    if (!/^\d{6}$/.test(digits)) {
      setError(t('account.mfaCodeInvalid'));
      return;
    }
    setError(null);
    setPending(true);
    const accepted = await verifyCode(enrolment?.factorId ?? null, digits).catch(() => false);
    if (!accepted) {
      setPending(false);
      setCode('');
      setError(t('account.mfaCodeInvalid'));
      return;
    }
    await refresh();
    setEnrolment(null);
    setCode('');
    setPending(false);
  };

  const turnOff = () =>
    Alert.alert(t('app.account.mfaDisableConfirm'), t('app.account.mfaDisableBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('account.mfaDisable'),
        style: 'destructive',
        onPress: async () => {
          setError(null);
          setPending(true);
          const removed = await removeSecondFactor().catch(() => false);
          await refresh();
          setPending(false);
          if (!removed) setError(t('common.errorBody'));
        },
      },
    ]);

  const openInApp = () => {
    if (!enrolment) return;
    setNoApp(false);
    Linking.openURL(enrolment.uri).catch(() => setNoApp(true));
  };

  const codeForm = (
    <>
      <Field label={t('account.mfaCode')} error={error}>
        <TextField
          value={code}
          onChangeText={setCode}
          accessibilityLabel={t('account.mfaCode')}
          ltr
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          onSubmitEditing={verify}
        />
      </Field>
      <View style={{ alignItems: 'flex-start' }}>
        <Button label={t('account.mfaVerify')} loading={pending} onPress={verify} />
      </View>
    </>
  );

  let body: React.ReactNode;
  if (state.isPending) {
    body = <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />;
  } else if (state.data?.enrolled && state.data.level === 'aal2') {
    body = (
      <View style={{ gap: space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <Check size={16} color={colors.success} />
          <Text variant="small" weight="medium" tone="success" style={{ flexShrink: 1 }}>
            {t('account.mfaEnabled')}
          </Text>
        </View>
        {error ? (
          <Text variant="small" tone="destructive" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <View style={{ alignItems: 'flex-start' }}>
          <Button
            label={t('account.mfaDisable')}
            variant="outline"
            icon={<ShieldOff size={16} color={colors.foreground} />}
            loading={pending}
            onPress={turnOff}
          />
        </View>
      </View>
    );
  } else if (state.data?.enrolled) {
    // Set up, not yet proven by this session: the code, and nothing else.
    body = (
      <View style={{ gap: space[3] }}>
        <Text variant="small">{t('account.mfaChallengeBody')}</Text>
        {codeForm}
      </View>
    );
  } else if (enrolment) {
    body = (
      <View style={{ gap: space[4] }}>
        <Text variant="small">{t('account.mfaScan')}</Text>
        <View style={{ alignItems: 'flex-start' }}>
          <Button
            label={t('app.account.mfaOpenApp')}
            variant="outline"
            icon={<ExternalLink size={16} color={colors.foreground} />}
            onPress={openInApp}
          />
        </View>
        {noApp ? (
          <Text variant="small" tone="mutedForeground" accessibilityLiveRegion="polite">
            {t('app.account.mfaNoApp')}
          </Text>
        ) : null}
        {/* For an authenticator on another device. Supabase draws the code as an SVG. */}
        <View
          accessible={false}
          style={{ alignSelf: 'flex-start', padding: space[2], borderRadius: radius.lg, backgroundColor: '#FFFFFF' }}
        >
          <SvgXml xml={enrolment.qr.replace(/^data:image\/svg\+xml;utf-8,/, '')} width={176} height={176} />
        </View>
        <View style={{ gap: space[1] }}>
          <Text variant="small" tone="mutedForeground">
            {t('account.mfaSecret')}
          </Text>
          <Text
            selectable
            variant="small"
            weight="medium"
            style={{ writingDirection: 'ltr', textAlign: 'left', padding: space[2], borderRadius: radius.md, backgroundColor: colors.muted }}
          >
            {enrolment.secret}
          </Text>
        </View>
        {codeForm}
      </View>
    );
  } else {
    body = (
      <View style={{ gap: space[3] }}>
        {error ? (
          <Text variant="small" tone="destructive" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <View style={{ alignItems: 'flex-start' }}>
          <Button
            label={t('account.mfaSetup')}
            icon={<ShieldCheck size={16} color={colors.primaryForeground} />}
            loading={pending}
            onPress={begin}
          />
        </View>
      </View>
    );
  }

  return (
    <Card style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <ShieldCheck size={16} color={colors.foreground} />
          <Text weight="semibold" accessibilityRole="header">
            {t('account.mfaTitle')}
          </Text>
        </View>
        <Text variant="small" tone="mutedForeground">
          {t('account.mfaBody')}
        </Text>
      </View>
      {body}
    </Card>
  );
}
