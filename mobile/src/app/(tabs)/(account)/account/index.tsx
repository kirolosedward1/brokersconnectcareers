import type { ReactNode } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { useTranslations } from 'use-intl';
import { ExternalLink, LogOut, Mail, ShieldAlert, Trash2 } from 'lucide-react-native';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Chip } from '~/components/ui/chip';
import { ForwardChevron } from '~/components/ui/icons';
import { LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useMobileConfig } from '~/features/config';
import { env } from '~/lib/env';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { useTheme, type ThemePreference } from '~/theme/provider';
import { hitTarget, radius, space } from '~/theme/tokens';

/**
 * The Account tab. Signed out, it is the door: sign in, create an account, or
 * register a company. Signed in, who this is, the app's appearance, the way to
 * the website (where the admin console stays), signing out of this phone, and
 * deleting the account — which an app that creates accounts must offer in the
 * app itself.
 *
 * Signing out here is this phone only (`scope: 'local'`): leaving the app
 * should not end a session on somebody's laptop.
 */
export default function AccountScreen() {
  const t = useTranslations();
  const { colors, preference, setPreference } = useTheme();
  const { ready, session, viewer } = useSession();
  const config = useMobileConfig();
  const supportEmail = config.data?.supportEmail ?? null;
  const version = Constants.expoConfig?.version ?? '';

  const themes: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: t('theme.light') },
    { value: 'dark', label: t('theme.dark') },
    { value: 'system', label: t('theme.system') },
  ];

  if (!ready) return <LoadingState />;

  const role = viewer?.profile?.role;

  return (
    <>
      <Stack.Screen options={{ title: t('app.tabs.account'), headerLargeTitle: true }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[6] }}
      >
        {session ? (
          <Card style={{ gap: space[1] }}>
            {viewer?.profile?.full_name ? (
              <Text variant="title" weight="bold">
                {viewer.profile.full_name}
              </Text>
            ) : null}
            <Text variant="small" tone="mutedForeground">
              {t('app.account.signedInAs', { email: session.user.email ?? '' })}
            </Text>
            {role === 'candidate' || role === 'employer' ? (
              <Text variant="small">
                {role === 'employer' ? t('onboarding.roleKnownEmployer') : t('onboarding.roleKnownCandidate')}
              </Text>
            ) : null}
            {viewer?.company ? (
              <Text variant="small" weight="medium">
                {viewer.company.name_ar}
              </Text>
            ) : null}
            {role === 'admin' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[2] }}>
                <ShieldAlert size={16} color={colors.warning} />
                <Text variant="small" tone="mutedForeground" style={{ flexShrink: 1 }}>
                  {t('app.account.adminOnWeb')}
                </Text>
              </View>
            ) : null}
          </Card>
        ) : (
          <View style={{ gap: space[3] }}>
            <View style={{ gap: space[1] }}>
              <Text variant="title" weight="bold" accessibilityRole="header">
                {t('app.account.signedOutTitle')}
              </Text>
              <Text tone="mutedForeground">{t('app.account.signedOutBody')}</Text>
            </View>
            <Button label={t('nav.signIn')} size="lg" onPress={() => router.push('/sign-in')} />
            <Button label={t('nav.signUp')} variant="outline" size="lg" onPress={() => router.push('/sign-up')} />
            <Button
              label={t('app.auth.forCompanies')}
              variant="ghost"
              onPress={() => router.push({ pathname: '/sign-up', params: { role: 'employer' } })}
            />
          </View>
        )}

        <View style={{ gap: space[2] }}>
          <Text variant="small" weight="semibold" tone="mutedForeground">
            {t('app.account.appearance')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }} accessibilityRole="radiogroup">
            {themes.map((theme) => (
              <Chip
                key={theme.value}
                label={theme.label}
                selected={preference === theme.value}
                onPress={() => setPreference(theme.value)}
              />
            ))}
          </View>
        </View>

        <View
          style={{
            borderRadius: radius.xl,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            overflow: 'hidden',
          }}
        >
          <Row
            icon={<ExternalLink size={18} color={colors.foreground} />}
            label={t('app.account.openWebsite')}
            onPress={() => WebBrowser.openBrowserAsync(env.siteUrl).catch(() => {})}
          />
          {supportEmail ? (
            <Row
              icon={<Mail size={18} color={colors.foreground} />}
              label={t('app.account.contact')}
              onPress={() => Linking.openURL(`mailto:${supportEmail}`).catch(() => {})}
            />
          ) : null}
          {session ? (
            <Row
              icon={<LogOut size={18} color={colors.foreground} />}
              label={t('nav.signOut')}
              onPress={() => supabase.auth.signOut({ scope: 'local' }).catch(() => {})}
            />
          ) : null}
          {session ? (
            <Row
              icon={<Trash2 size={18} color={colors.destructive} />}
              label={t('account.deleteTitle')}
              destructive
              onPress={() => router.push('/account/delete')}
            />
          ) : null}
        </View>

        {version ? (
          <Text variant="caption" tone="mutedForeground" style={{ textAlign: 'center' }}>
            {t('app.account.version', { version })}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}

function Row({
  icon,
  label,
  onPress,
  destructive = false,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hitTarget + 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingHorizontal: space[4],
        backgroundColor: pressed ? colors.muted : 'transparent',
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      })}
    >
      {icon}
      <Text tone={destructive ? 'destructive' : 'foreground'} style={{ flex: 1 }}>
        {label}
      </Text>
      <ForwardChevron size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}
