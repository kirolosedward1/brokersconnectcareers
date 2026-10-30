import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useLocale, useTranslations } from 'use-intl';
import { formatDateTime } from '@/lib/format';
import { localized } from '@/lib/locale';
import {
  BellRing,
  Briefcase,
  Building2,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  LifeBuoy,
  Lock,
  MailCheck,
  Palette,
  Receipt,
  Scale,
  ShieldCheck,
  Trash2,
  UserRound,
  UserRoundPlus,
} from '~/components/ui/lucide';
import { OPERATOR } from '@/lib/business';
import { canAccessAdminArea, canAccessCandidateArea, canAccessEmployerArea } from '@/lib/permissions';
import { PhotoControls } from '~/components/account/photo-controls';
import { StandingNotice } from '~/components/dashboard/standing-notice';
import { useHeaderBell } from '~/components/notifications/header-bell';
import { CompletenessRing } from '~/components/profile/completeness-ring';
import { useAgentProfile, useCandidateSummary } from '~/features/profile/queries';
import { Avatar } from '~/components/ui/avatar';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { SignInMark, SignOutMark } from '~/components/ui/icons';
import { Num } from '~/components/ui/num';
import { SettingsGroup, SettingsRow } from '~/components/ui/settings-list';
import { LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useMobileConfig } from '~/features/config';
import { useFewerKinds } from '~/features/jobs/fewer';
import { useListOwner } from '~/features/jobs/recent';
import { useHiddenAgentEntries } from '~/features/moderation/hidden-agents';
import { useHiddenCompanyEntries } from '~/features/moderation/hidden-companies';
import { useHiddenJobEntries } from '~/features/moderation/hidden-jobs';
import { signOutHere } from '~/features/push/device';
import { useTabList } from '~/features/tab-bar';
import { buildMarker, publishedAt, shownVersion } from '~/features/update';
import { useScreenRefresh } from '~/lib/use-pull-refresh';
import { withAppMarker } from '~/lib/app-marker';
import { env } from '~/lib/env';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';
import { markupTags } from '~/i18n/rich';

/**
 * The Account tab, grouped as the Account board draws it. Signed out, it is
 * the door: sign in, create an account, or register a company. Signed in, who
 * this is, their photo and how complete the profile is; for a consultant the
 * profile and the directory (the profile, how companies see it, whether they
 * are looking, who sees them); the account (signing in and security, the
 * pushes, the emails, what this phone hides); the app (its appearance, privacy
 * for those without a card, help, the website); signing out of this phone, and
 * deleting the account — which an app that creates accounts must offer in the
 * app itself.
 *
 * Signing out here is this phone only (`scope: 'local'`): leaving the app
 * should not end a session on somebody's laptop.
 */
export default function AccountScreen() {
  const t = useTranslations();
  const bell = useHeaderBell();
  const locale = useLocale();
  const { colors, preference } = useTheme();
  const { ready, session, viewer, actor } = useSession();
  const config = useMobileConfig();
  // Read for a candidate only (useCandidateSummary): nobody else has a profile score.
  const completeness = useCandidateSummary().data?.profile_completeness ?? null;
  // What this phone hides, signed in or not — and the kinds this person sees fewer of: the way back to it, once there is any.
  const hiddenCount =
    useHiddenCompanyEntries().length + useHiddenAgentEntries().length + useHiddenJobEntries().length + useFewerKinds(useListOwner()).length;
  // The directory card's two answers the rows say (Job-seeking status, Privacy).
  const agent = useAgentProfile().data?.agent ?? null;
  const list = useTabList();
  const pull = useScreenRefresh();
  const [signingOut, setSigningOut] = useState(false);
  const version = shownVersion() ?? '';
  const published = publishedAt();
  // Which code this phone runs, and which the website does: the two are
  // published from the same push, so the commits match once both have taken
  // it, and "is the fix on my phone, and is it on the site?" is read, not guessed.
  const marker = [buildMarker(), config.data?.commit ? t('app.account.websiteAt', { commit: config.data.commit.slice(0, 7) }) : null]
    .filter(Boolean)
    .join(' · ');

  const themeLabel = t(`theme.${preference}`);

  if (!ready) return <LoadingState />;

  const role = viewer?.profile?.role;

  return (
    <>
      <Stack.Screen options={{ title: t('app.tabs.account'), headerRight: bell }} />
      <ScrollView
        {...list}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
        contentContainerStyle={{
          padding: gutter,
          paddingBottom: space[12],
          gap: space[6],
        }}
      >
        {viewer?.profile?.role === 'admin' ? <StandingNotice profile={viewer.profile} company={viewer.company} companyOnly /> : null}
        {session ? (
          <Card style={{ gap: space[1] }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[3],
              }}
            >
              {viewer?.profile ? (
                // A candidate's profile completeness round the photo (CompletenessRing); a tap opens the profile.
                <CompletenessRing percent={completeness} size={64} radius={32} onPress={() => router.push('/account/profile')}>
                  <Avatar name={viewer.profile.full_name} src={viewer.profile.avatar_url} size="lg" />
                </CompletenessRing>
              ) : null}
              <View style={{ flex: 1, gap: space[1] }}>
                {viewer?.profile?.full_name ? (
                  <Text variant="title" weight="semibold">
                    {viewer.profile.full_name}
                  </Text>
                ) : null}
                <Text variant="small" tone="mutedForeground">
                  {t('app.account.signedInAs', {
                    email: session.user.email ?? '',
                  })}
                </Text>
              </View>
            </View>
            {role === 'candidate' || role === 'employer' ? (
              <Text variant="small">{role === 'employer' ? t('onboarding.roleKnownEmployer') : t('onboarding.roleKnownCandidate')}</Text>
            ) : null}
            {completeness != null ? (
              <Text variant="small" tone="mutedForeground">
                {t.markup('app.account.completeness', {
                  percent: completeness,
                  ...markupTags,
                })}
                {agent?.visibility ? ` · ${t(`visibility.${agent.visibility}`)}` : ''}
              </Text>
            ) : null}
            {viewer?.company ? (
              <Text variant="small" weight="medium">
                {localized(locale, viewer.company.name_ar, viewer.company.name_en)}
              </Text>
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
              <Text variant="title" weight="semibold" accessibilityRole="header">
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
              onPress={() =>
                router.push({
                  pathname: '/sign-up',
                  params: { role: 'employer' },
                })
              }
            />
          </View>
        )}

        {/* Who sees the profile is decided first, so it comes first (the Account board). */}
        {canAccessCandidateArea(actor) ? (
          <SettingsGroup title={t('app.account.groupProfile')}>
            <SettingsRow
              icon={<UserRound size={18} color={colors.primary} />}
              label={t('app.account.profileAndCv')}
              onPress={() => router.push('/account/profile')}
            />
            <SettingsRow
              icon={<Eye size={18} color={colors.primary} />}
              label={t('app.account.previewProfile')}
              onPress={() => router.push('/account/profile/preview')}
            />
            <SettingsRow
              icon={<Briefcase size={18} color={colors.primary} />}
              label={t('app.account.jobSeeking')}
              value={agent?.availability ? t(`availability.${agent.availability}`) : undefined}
              onPress={() => router.push('/account/availability')}
            />
            <SettingsRow
              icon={<Lock size={18} color={colors.primary} />}
              label={t('app.account.privacy')}
              value={agent?.visibility ? t(`visibility.${agent.visibility}`) : undefined}
              onPress={() => router.push('/account/privacy')}
            />
          </SettingsGroup>
        ) : null}

        {/* The admin console has a tab of its own; this is the way to it from the account, as the website's menu has.
            An employer's company and billing: the website's console keeps them, the app here. */}
        {canAccessAdminArea(actor) || canAccessEmployerArea(actor) ? (
          <SettingsGroup>
            {canAccessAdminArea(actor) ? (
              <SettingsRow
                icon={<ShieldCheck size={18} color={colors.primary} />}
                label={t('app.admin.adminConsole')}
                onPress={() => router.navigate('/admin')}
              />
            ) : null}
            {canAccessEmployerArea(actor) ? (
              <>
                <SettingsRow
                  icon={<Building2 size={18} color={colors.primary} />}
                  label={t('employer.company')}
                  onPress={() => router.push('/employer/company' as never)}
                />
                <SettingsRow
                  icon={<Receipt size={18} color={colors.primary} />}
                  label={t('employer.billing')}
                  onPress={() => router.push('/employer/billing' as never)}
                />
              </>
            ) : null}
          </SettingsGroup>
        ) : null}

        {session || hiddenCount ? (
          <SettingsGroup title={t('app.account.groupAccount')}>
            {session ? (
              <>
                <SettingsRow
                  icon={<ShieldCheck size={18} color={colors.primary} />}
                  label={t('app.account.security')}
                  onPress={() => router.push('/account/security')}
                />
                {/* One word each; the screens they open say the rest. */}
                <SettingsRow
                  icon={<BellRing size={18} color={colors.primary} />}
                  label={t('app.account.notifications')}
                  onPress={() => router.push('/account/alerts')}
                />
                <SettingsRow
                  icon={<MailCheck size={18} color={colors.primary} />}
                  label={t('app.account.messages')}
                  onPress={() => router.push('/account/emails')}
                />
              </>
            ) : null}
            {/* What this phone hides, signed in or not: the way back to it, once there is any. */}
            {hiddenCount ? (
              <SettingsRow
                icon={<EyeOff size={18} color={colors.primary} />}
                label={t('app.moderation.hiddenList')}
                value={<Num variant="small" tone="mutedForeground" value={hiddenCount} />}
                onPress={() => router.push('/account/hidden')}
              />
            ) : null}
          </SettingsGroup>
        ) : null}

        <SettingsGroup title={t('app.account.groupApp')}>
          <SettingsRow
            icon={<Palette size={18} color={colors.primary} />}
            label={t('app.account.appearanceRow')}
            value={themeLabel}
            onPress={() => router.push('/account/appearance')}
          />
          {/* Analytics and a copy of the data, for those without a directory card to place. */}
          {!canAccessCandidateArea(actor) ? (
            <SettingsRow
              icon={<Lock size={18} color={colors.primary} />}
              label={t('app.account.privacy')}
              onPress={() => router.push('/account/privacy')}
            />
          ) : null}
          <SettingsRow
            icon={<LifeBuoy size={18} color={colors.primary} />}
            label={t('app.account.support')}
            onPress={() => router.push('/account/support')}
          />
          <SettingsRow
            icon={<ExternalLink size={18} color={colors.primary} />}
            label={t('app.account.openWebsite')}
            onPress={() => WebBrowser.openBrowserAsync(withAppMarker(env.siteUrl)).catch(() => {})}
          />
        </SettingsGroup>

        {session ? (
          <SettingsGroup>
            <SettingsRow
              icon={<SignOutMark size={18} color={colors.primary} />}
              label={t('nav.signOut')}
              busy={signingOut}
              onPress={() => {
                setSigningOut(true);
                signOutHere()
                  .catch(() => {})
                  .then(() => setSigningOut(false));
              }}
            />
            <SettingsRow
              icon={<Trash2 size={18} color={colors.destructive} />}
              label={t('app.account.deleteAccount')}
              destructive
              onPress={() => router.push('/account/delete')}
            />
          </SettingsGroup>
        ) : null}

        {/* One tap away, signed in or not, as the store and the law expect of
            an app: the policies a person agrees to, the notices owed to the
            software it is made of, and who runs it. */}
        <SettingsGroup title={t('footer.about')}>
          <SettingsRow
            icon={<Lock size={18} color={colors.primary} />}
            label={t('footer.privacy')}
            onPress={() => openSitePage('/privacy')}
          />
          <SettingsRow
            icon={<FileText size={18} color={colors.primary} />}
            label={t('footer.terms')}
            onPress={() => openSitePage('/terms')}
          />
          <SettingsRow
            icon={<Scale size={18} color={colors.primary} />}
            label={t('licenses.title')}
            onPress={() => router.push('/account/licenses')}
          />
        </SettingsGroup>

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
          {marker ? (
            <Text
              selectable
              variant="caption"
              tone="mutedForeground"
              testID="build-marker"
              style={{ textAlign: 'center', writingDirection: 'ltr' }}
            >
              {marker}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}

/** A page of the website, in the in-app browser: the policies live there, in one copy. */
function openSitePage(path: '/privacy' | '/terms') {
  WebBrowser.openBrowserAsync(withAppMarker(`${env.siteUrl}${path}`)).catch(() => {});
}
