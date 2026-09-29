import { useRef } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslations } from 'use-intl';
import { Eye, Info } from 'lucide-react-native';
import { canAccessCandidateArea } from '@/lib/permissions';
import { AppealPanel } from '~/components/moderation/appeal-panel';
import { CvSections } from '~/components/profile/cv-sections';
import { ProfileForm } from '~/components/profile/profile-form';
import { ProfileGaps } from '~/components/profile/profile-gaps';
import { RecordForm } from '~/components/profile/record-form';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/notice';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useAgentProfile, useCandidateSummary, useCompleteness, useCvSections } from '~/features/profile/queries';
import { markupTags } from '~/i18n/rich';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * The candidate's directory profile — the website's /dashboard/profile, which
 * the app keeps in the Account tab: what is missing and why, the form, the
 * sales record and the CV sections, with what moderation has decided about
 * it said first (and the way to ask for a second look).
 *
 * A profile that could not be read is an error, never an empty form: filling
 * one in again over a profile that exists would be the worst answer.
 */
export default function ProfileScreen() {
  const t = useTranslations();
  const { colors } = useTheme();
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const { session, viewer, actor } = useSession();
  const scroll = useRef<ScrollView>(null);
  const formY = useRef(0);

  const profile = useAgentProfile();
  const agent = profile.data?.agent ?? null;
  const cv = useCvSections(agent?.id ?? null);
  const completeness = useCompleteness(agent?.id ?? null).data ?? null;
  const views = useCandidateSummary().data?.profile_views_30d ?? 0;

  const header = <Stack.Screen options={{ title: t('dashboard.profile') }} />;

  if (!session) {
    return (
      <>
        {header}
        <EmptyState
          title={t('app.account.signedOutTitle')}
          action={<Button label={t('nav.signIn')} onPress={() => router.push('/sign-in')} />}
        />
      </>
    );
  }
  if (!viewer?.profile || (canAccessCandidateArea(actor) && profile.isPending)) {
    return (
      <>
        {header}
        {viewer?.profile ? <LoadingState /> : <ViewerPending />}
      </>
    );
  }
  if (!canAccessCandidateArea(actor)) {
    // Only a candidate has a directory profile; a link from somebody else's account lands here.
    return (
      <>
        {header}
        <EmptyState title={t('common.notFound')} body={t('common.notFoundBody')} />
      </>
    );
  }
  if (profile.isError) {
    return (
      <>
        {header}
        <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
      </>
    );
  }
  const developerIds = profile.data?.developerIds ?? [];

  const refreshing = profile.isRefetching || cv.isRefetching;

  return (
    <>
      {header}
      <ScrollView
        ref={scroll}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              profile.refetch();
              cv.refetch();
            }}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[6] }}
      >
        <Text tone="mutedForeground">{t('dashboard.profileLede')}</Text>

        {/* The result of everything below, one tap away: the card as companies see it, with who sees what. */}
        {agent ? (
          <View style={{ alignItems: 'flex-start' }}>
            <Button
              label={t('dashboard.profilePreview')}
              variant="outline"
              icon={<Eye size={16} color={colors.foreground} />}
              onPress={() => router.push('/account/profile/preview')}
            />
          </View>
        ) : null}

        {/* Sent here from the consultant directory, which is not a candidate's to browse. */}
        {notice === 'directory' ? (
          <Notice tone="muted" icon={<Info size={16} color={colors.primary} />} title={t('agents.deniedNotice')} />
        ) : null}

        {/* A restricted profile stays hidden whatever its visibility says; the reason is the one given. */}
        {agent?.restricted_at ? (
          <Notice tone="destructive">
            <Text variant="small">
              {`${t('dashboard.profileRestricted')}${agent.restriction_reason ? ` «${agent.restriction_reason}»` : ''}`}
            </Text>
            <AppealPanel subjectType="agent" subjectId={agent.id} />
          </Notice>
        ) : null}

        {/* Only once somebody has looked; companies, never which ones. */}
        {views > 0 ? (
          <Notice tone="success" icon={<Eye size={16} color={colors.success} />} title={t.markup('dashboard.profileViews', { count: views, ...markupTags })} />
        ) : null}

        {agent ? (
          <ProfileGaps
            agent={agent}
            completeness={completeness}
            hasExperience={(cv.data?.experience.length ?? 0) > 0}
            hasEducation={(cv.data?.education.length ?? 0) > 0}
            onFill={() => scroll.current?.scrollTo({ y: formY.current, animated: true })}
          />
        ) : null}

        <View
          onLayout={(event) => {
            formY.current = event.nativeEvent.layout.y;
          }}
        >
          <ProfileForm profile={viewer.profile} agent={agent} developerIds={developerIds} />
        </View>

        {agent ? (
          <>
            <RecordForm key={agent.id} agent={agent} completeness={completeness} />
            {cv.isError ? (
              <ErrorState error={cv.error} onRetry={() => cv.refetch()} />
            ) : cv.data ? (
              <CvSections agentId={agent.id} sections={cv.data} />
            ) : (
              <LoadingState />
            )}
          </>
        ) : (
          // Everything below hangs on a profile: until the form is saved once there is nothing to add to.
          <Text variant="small" tone="mutedForeground">
            {t('app.profile.saveFirst')}
          </Text>
        )}
      </ScrollView>
    </>
  );
}
