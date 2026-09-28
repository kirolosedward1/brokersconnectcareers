import { useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useTranslations } from 'use-intl';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { appleAuthorizationCode } from '~/features/auth/providers';
import { useMobileConfig } from '~/features/config';
import { callAction } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { space } from '~/theme/tokens';

/**
 * Delete the account — the website's section, through its action
 * (deleteMyAccount), which removes the account, the profile, every
 * application and every uploaded file.
 *
 * The word typed out, as on the website: a button alone is one stray tap from
 * an irreversible loss. An account made with Apple is asked to confirm with
 * Apple first, which hands the website a one-time code to revoke the app's
 * access to the Apple ID — deleting only the account would leave the app
 * listed there. An account that owns a company cannot be deleted from here or
 * from the website: other people's applications belong to that company, and
 * the team handles it with the owner. Nor, while a suspension stands, can the
 * suspended account: its records are what the case is about (the website's
 * rule; the person can appeal, or write to the team).
 */
export default function DeleteAccountScreen() {
  const t = useTranslations();
  const { session, viewer } = useSession();
  const config = useMobileConfig();
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const word = t('account.deleteConfirmWord');
  const confirmLabel = t.markup('account.deleteConfirmLabel', { word, b: (chunks: string) => chunks });
  const ownsCompany = Boolean(viewer?.company && viewer.company.owner_id === viewer.userId);
  const user = session?.user;
  const signsInWithApple =
    (user?.identities ?? []).some((identity) => identity.provider === 'apple') ||
    ((user?.app_metadata?.providers as string[] | undefined) ?? []).includes('apple');
  const supportEmail = config.data?.supportEmail ?? null;

  async function remove() {
    setError(null);
    setPending(true);

    let appleCode: string | undefined;
    if (signsInWithApple) {
      const code = await appleAuthorizationCode();
      if (!code) {
        setPending(false);
        setError(t('app.account.deleteAppleFailed'));
        return;
      }
      appleCode = code;
    }

    const result = await callAction('deleteMyAccount', appleCode ? { appleAuthorizationCode: appleCode } : {}).catch(
      () => null,
    );
    if (!result?.ok) {
      setPending(false);
      const code = result && !result.ok ? result.error : null;
      setError(
        code === 'owns_company'
          ? t('account.deleteBlockedCompany')
          : code === 'under_review'
            ? t('account.deleteBlockedSuspended')
            : code === 'apple_reauth_required'
              ? t('app.account.deleteAppleFailed')
              : t('account.deleteUnavailable'),
      );
      return;
    }

    // The account no longer exists; what is left on this phone goes with it.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    router.back();
    Alert.alert(t('app.account.deleted'));
  }

  return (
    <>
      <Stack.Screen options={{ title: t('account.deleteTitle') }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[5] }}
      >
        <Text>{t('account.deleteBody')}</Text>

        {ownsCompany ? (
          <View style={{ gap: space[3] }}>
            <Notice tone="warning">{t('account.deleteBlockedCompany')}</Notice>
            {supportEmail ? (
              <Button
                label={t('app.account.contact')}
                variant="outline"
                onPress={() => Linking.openURL(`mailto:${supportEmail}`).catch(() => {})}
              />
            ) : null}
          </View>
        ) : (
          <View style={{ gap: space[4] }}>
            {signsInWithApple ? <Notice tone="muted">{t('app.account.deleteApple')}</Notice> : null}

            <Field label={confirmLabel}>
              <TextField
                value={typed}
                onChangeText={setTyped}
                accessibilityLabel={confirmLabel}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </Field>

            {error ? <Notice tone="destructive">{error}</Notice> : null}

            <Button
              label={t('account.deleteCta')}
              variant="destructive"
              size="lg"
              loading={pending}
              disabled={typed.trim() !== word}
              onPress={remove}
            />
          </View>
        )}
      </ScrollView>
    </>
  );
}
