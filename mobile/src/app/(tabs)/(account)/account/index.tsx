import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useLocale, useTranslations } from 'use-intl';
import { formatDateTime } from '@/lib/format';
import {
  BellRing,
  Building2,
  Download,
  ExternalLink,
  EyeOff,
  FileText,
  Lock,
  Mail,
  MailCheck,
  Receipt,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
  UserRoundPlus,
} from '~/components/ui/lucide';
import { OPERATOR } from '@/lib/business';
import { canAccessCandidateArea, canAccessEmployerArea } from '@/lib/permissions';
import { PhotoControls } from '~/components/account/photo-controls';
import { useHeaderBell } from '~/components/notifications/header-bell';
import { Avatar } from '~/components/ui/avatar';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { ForwardChevron, SignInMark, SignOutMark } from '~/components/ui/icons';
import { Segmented } from '~/components/ui/segmented';
import { LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { shareMyData } from '~/features/account/settings';
import { useMobileConfig } from '~/features/config';
import { useHiddenAgentEntries } from '~/features/moderation/hidden-agents';
import { useHiddenCompanyEntries } from '~/features/moderation/hidden-companies';
import { signOutHere } from '~/features/push/device';
import { useTabList } from '~/features/tab-bar';
import { publishedAt, shownVersion } from '~/features/update';
import { ApiError } from '~/lib/api';
import { env } from '~/lib/env';
import { useSession } from '~/lib/session';
import { useTheme, type ThemePreference } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';

/**
 * The Account tab. Signed out, it is the door: sign in, create an account, or
 * register a company. Signed in, who this is and their photo, the app's
 * appearance, the settings the website keeps on /dashboard/account (signing in
 * and security, the emails, a copy of the data), the way to the website
 * (where the admin console stays), signing out of this phone, and deleting the
 * account — which an app that creates accounts must offer in the app itself.
 *
 * Signing out here is this phone only (`scope: 'local'`): leaving the app
 * should not end a session on somebody's laptop.
 */
export default function AccountScreen() {
  const t = useTranslations();
  const bell = useHeaderBell();
  const locale = useLocale();
  const { colors, preference, setPreference } = useTheme();
  const { ready, session, viewer, actor } = useSession();
  const config = useMobileConfig();
  // What this phone hides, signed in or not: the way back to it, once there is any.
  const hiddenCount = useHiddenCompanyEntries().length + useHiddenAgentEntries().length;
  // The website's own fallback (its footer and the config route): the
  // operator's published address when no support inbox is set.
  const supportEmail = config.data?.supportEmail || OPERATOR.email;
  const [exporting, setExporting] = useState(false);
  const list = useTabList();
  const [signingOut, setSigningOut] = useState(false);
  const version = shownVersion() ?? '';
  const published = publishedAt();

  const themes: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: t('theme.light') },
    { value: 'dark', label: t('theme.dark') },
    { value: 'system', label: t('theme.system') },
  ];

  if (!ready) return <LoadingState />;

  const role = viewer?.profile?.role;

  // The portability right: the website's export, handed to the share sheet.
  // A promise chain, not try/finally, which the React Compiler does not compile.
  const exportData = () => {
    if (!session || exporting) return;
    setExporting(true);
    shareMyData(session.user.id, t('account.exportTitle'))
      .catch((failure: unknown) => {
        const status = failure instanceof ApiError ? failure.status : -1;
        Alert.alert(
          t('account.exportTitle'),
          status === 429 ? t('app.account.exportLimit') : status === 0 ? t('app.offline.body') : t('common.errorBody'),
        );
      })
      .then(() => setExporting(false));
  };

  return (
    <>
      <Stack.Screen options={{ title: t('app.tabs.account'), headerRight: bell }} />
      <ScrollView
        {...list}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: gutter, paddingBottom: space[12], gap: space[6] }}
      >
        {session ? (
          <Card style={{ gap: space[1] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
              {viewer?.profile ? (
                <Avatar name={viewer.profile.full_name} src={viewer.profile.avatar_url} seed={viewer.profile.id} size="lg" />
              ) : null}
              <View style={{ flex: 1, gap: space[1] }}>
                {viewer?.profile?.full_name ? (
                  <Text variant="title" weight="bold">
                    {viewer.profile.full_name}
                  </Text>
                ) : null}
                <Text variant="small" tone="mutedForeground">
                  {t('app.account.signedInAs', { email: session.user.email ?? '' })}
                </Text>
              </View>
            </View>
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
            {/* The one thing here other people see. */}
            {viewer?.profile ? (
              <View style={{ marginTop: space[3] }}>
                <PhotoControls hasPhoto={Boolean(viewer.profile.avatar_url)} />
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
            <Button
              label={t('nav.signIn')}
              size="lg"
              icon={<SignInMark size={20} color={colors.primaryForeground} />}
              onPress={() => router.push('/sign-in')}
            />
            <Button
              label={t('nav.signUp')}
              variant="outline"
              size="lg"
              icon={<UserRoundPlus size={20} color={colors.foreground} />}
              onPress={() => router.push('/sign-up')}
            />
            <Button
              label={t('app.auth.forCompanies')}
              variant="ghost"
              icon={<Building2 size={18} color={colors.foreground} />}
              onPress={() => router.push({ pathname: '/sign-up', params: { role: 'employer' } })}
            />
          </View>
        )}

        <View style={{ gap: space[2] }}>
          <GroupTitle>{t('app.account.appearance')}</GroupTitle>
          <Segmented label={t('app.account.appearance')} options={themes} value={preference} onChange={setPreference} />
        </View>

        <Group>
          {/* A candidate's directory profile: the website keeps it in the console, the app here. */}
          {canAccessCandidateArea(actor) ? (
            <Row
              icon={<UserRound size={18} color={colors.primary} />}
              label={t('dashboard.profile')}
              onPress={() => router.push('/account/profile')}
            />
          ) : null}
          {/* An employer's company, team and billing: the website's console keeps them, the app here. */}
          {canAccessEmployerArea(actor) ? (
            <>
              <Row
                icon={<Building2 size={18} color={colors.primary} />}
                label={t('employer.company')}
                onPress={() => router.push('/employer/company' as never)}
              />
              <Row
                icon={<Receipt size={18} color={colors.primary} />}
                label={t('employer.billing')}
                onPress={() => router.push('/employer/billing' as never)}
              />
            </>
          ) : null}
          {session ? (
            <>
              <Row
                icon={<ShieldCheck size={18} color={colors.primary} />}
                label={t('app.account.security')}
                onPress={() => router.push('/account/security')}
              />
              <Row
                icon={<BellRing size={18} color={colors.primary} />}
                label={t('app.push.title')}
                onPress={() => router.push('/account/alerts')}
              />
              <Row
                icon={<MailCheck size={18} color={colors.primary} />}
                label={t('account.emailsTitle')}
                onPress={() => router.push('/account/emails')}
              />
              <Row
                icon={
                  exporting ? (
                    <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
                  ) : (
                    <Download size={18} color={colors.primary} />
                  )
                }
                label={t('account.exportCta')}
                onPress={exportData}
              />
            </>
          ) : null}
          <Row
            icon={<ExternalLink size={18} color={colors.primary} />}
            label={t('app.account.openWebsite')}
            onPress={() => WebBrowser.openBrowserAsync(env.siteUrl).catch(() => {})}
          />
          {supportEmail ? (
            <Row
              icon={<Mail size={18} color={colors.primary} />}
              label={t('app.account.contact')}
              // The address itself, not only a link to the mail app: a phone
              // with no mail account set up opens nothing, and says nothing.
              detail={supportEmail}
              onPress={() => Linking.openURL(`mailto:${supportEmail}`).catch(() => {})}
            />
          ) : null}
          {session ? (
            <Row
              icon={<SignOutMark size={18} color={colors.primary} />}
              label={t('nav.signOut')}
              busy={signingOut}
              onPress={() => {
                setSigningOut(true);
                signOutHere().then(() => setSigningOut(false));
              }}
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
        </Group>

        {hiddenCount ? (
          <Group>
            <Row
              icon={<EyeOff size={18} color={colors.primary} />}
              label={t('app.moderation.hiddenList')}
              onPress={() => router.push('/account/hidden')}
            />
          </Group>
        ) : null}

        {/* One tap away, signed in or not, as the store and the law expect of
            an app: the policies a person agrees to, the notices owed to the
            software it is made of, and who runs it. */}
        <View style={{ gap: space[2] }}>
          <GroupTitle header>{t('footer.about')}</GroupTitle>
          <Group>
            <Row
              icon={<Lock size={18} color={colors.primary} />}
              label={t('footer.privacy')}
              onPress={() => openSitePage('/privacy')}
            />
            <Row
              icon={<FileText size={18} color={colors.primary} />}
              label={t('footer.terms')}
              onPress={() => openSitePage('/terms')}
            />
            <Row
              icon={<Scale size={18} color={colors.primary} />}
              label={t('licenses.title')}
              onPress={() => router.push('/account/licenses')}
            />
          </Group>
        </View>

        <View style={{ gap: space[1] }}>
          <Text variant="caption" tone="mutedForeground" style={{ textAlign: 'center' }}>
            {t('footer.operatedBy', { name: OPERATOR.name })}
          </Text>
          {version ? (
            <Text variant="caption" tone="mutedForeground" style={{ textAlign: 'center' }}>
              {t('app.account.version', { version })}
              {published ? ` · ${t('app.account.published', { date: formatDateTime(published, locale) })}` : ''}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}

/** A page of the website, in the in-app browser: the policies live there, in one copy. */
function openSitePage(path: '/privacy' | '/terms') {
  WebBrowser.openBrowserAsync(`${env.siteUrl}${path}`).catch(() => {});
}

function Row({
  icon,
  label,
  detail,
  onPress,
  destructive = false,
  busy = false,
}: {
  icon: ReactNode;
  label: string;
  /** A second line under the label, for what the row leads to (an address). */
  detail?: string;
  onPress: () => void;
  destructive?: boolean;
  /** Its action is under way: said, and not started twice. */
  busy?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hitTarget + 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingStart: space[4],
        backgroundColor: pressed ? colors.muted : 'transparent',
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          ...corner('md'),
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: destructive ? colors.destructiveMuted : colors.secondary,
        }}
      >
        {icon}
      </View>
      {/* The rule above each row starts after its icon, as iOS draws a list. */}
      <View
        style={{
          flex: 1,
          alignSelf: 'stretch',
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[3],
          paddingEnd: space[4],
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          borderTopColor: colors.border,
        }}
      >
        <View style={{ flex: 1, paddingVertical: detail ? space[2] : 0 }}>
          <Text tone={destructive ? 'destructive' : 'foreground'}>{label}</Text>
          {detail ? (
            <Text variant="small" tone="mutedForeground" selectable>
              {detail}
            </Text>
          ) : null}
        </View>
        {busy ? <ActivityIndicator color={colors.mutedForeground} /> : <ForwardChevron size={18} color={colors.mutedForeground} />}
      </View>
    </Pressable>
  );
}

/**
 * Rows on one card. Each row draws the rule above it; the first one's sits
 * just outside the card's top edge, where the card clips it.
 */
function Group({ children }: { children: ReactNode }) {
  const { colors, shadow } = useTheme();
  return (
    <View style={{ ...corner('xl'), boxShadow: shadow.card }}>
      <View
        style={{
          ...corner('xl'),
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.border,
          backgroundColor: colors.card,
          overflow: 'hidden',
        }}
      >
        <View style={{ marginTop: -StyleSheet.hairlineWidth * 2 }}>{children}</View>
      </View>
    </View>
  );
}

function GroupTitle({ children, header = false }: { children: string; header?: boolean }) {
  return (
    <Text
      variant="label"
      weight="semibold"
      tone="mutedForeground"
      accessibilityRole={header ? 'header' : undefined}
      style={{ paddingHorizontal: space[1] }}
    >
      {children}
    </Text>
  );
}
