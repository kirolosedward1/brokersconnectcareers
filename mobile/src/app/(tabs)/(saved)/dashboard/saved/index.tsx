import { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useTranslations } from 'use-intl';
import { jobIsLive } from '@/lib/job-state';
import { JobCard } from '~/components/jobs/job-card';
import { useHeaderBell } from '~/components/notifications/header-bell';
import { SavedSearchList } from '~/components/saved/saved-search-list';
import { Button } from '~/components/ui/button';
import { Illustration } from '~/components/ui/illustration';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useAppliedJobIds } from '~/features/jobs/marks';
import { useSavedJobs, useSavedSearches } from '~/features/saved/queries';
import { useTabList } from '~/features/tab-bar';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';
import { UserRound } from '~/components/ui/lucide';
import { usePullRefresh } from '~/lib/use-pull-refresh';

/**
 * What the candidate kept — the website's /dashboard/saved: the bookmarked
 * listings, the ones still hiring first and the ended ones below a heading
 * that says why (never removed behind the reader's back: the bookmark is how
 * they leave), then the saved searches and followed companies with the
 * weekly email's switch.
 *
 * A read that failed says so rather than drawing an empty list — a bookmark
 * list that empties on a bad connection teaches that saving is unreliable.
 */
export default function SavedScreen() {
  const t = useTranslations();
  const bell = useHeaderBell();
  const { colors } = useTheme();
  const { session } = useSession();
  const jobs = useSavedJobs();
  const searches = useSavedSearches();
  const pull = usePullRefresh(() => Promise.all([jobs.refetch(), searches.refetch()]));
  const list = useTabList();

  const saved = useMemo(() => jobs.data ?? [], [jobs.data]);
  const applied = useAppliedJobIds(useMemo(() => saved.map((job) => job.id), [saved]));
  const open = saved.filter((job) => jobIsLive(job));
  const closed = saved.filter((job) => !jobIsLive(job));

  let body: React.ReactNode;
  if (!session) {
    body = (
      <EmptyState
        icon={UserRound}
        title={t('app.account.signedOutTitle')}
        action={<Button label={t('nav.signIn')} onPress={() => router.push('/sign-in')} />}
      />
    );
  } else if (jobs.isPending || searches.isPending) {
    body = <LoadingState />;
  } else if ((jobs.isError && !jobs.data) || (searches.isError && !searches.data)) {
    body = (
      <ErrorState
        error={jobs.error ?? searches.error}
        onRetry={() => {
          jobs.refetch();
          searches.refetch();
        }}
      />
    );
  } else {
    body = (
      <ScrollView
        {...list}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[8] }}
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.primary} />
        }
      >
        <Text tone="mutedForeground">{t('dashboard.savedLede')}</Text>

        {saved.length === 0 ? (
          <View
            style={{
              alignItems: 'center',
              gap: space[3],
              paddingVertical: space[8],
              paddingHorizontal: space[6],
              ...corner('xl'),
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderStyle: 'dashed',
              borderColor: colors.border,
            }}
          >
            <Illustration name="browse" width={160} />
            <Text weight="medium" style={{ textAlign: 'center' }}>
              {t('dashboard.emptySaved')}
            </Text>
            <Button label={t('jobs.title')} onPress={() => router.navigate('/jobs')} />
          </View>
        ) : (
          <View style={{ gap: space[6] }}>
            {open.length ? (
              <View style={{ gap: space[2] }}>
                {/* A heading only once there is a second group to tell this one from. */}
                {closed.length ? (
                  <Text variant="small" weight="semibold" tone="mutedForeground" accessibilityRole="header">
                    {t('dashboard.savedOpenHeading')}
                  </Text>
                ) : null}
                {open.map((job) => (
                  <JobCard key={job.id} job={job} applied={applied.has(job.id)} />
                ))}
              </View>
            ) : null}

            {closed.length ? (
              <View style={{ gap: space[2] }}>
                <View>
                  <Text variant="small" weight="semibold" tone="mutedForeground" accessibilityRole="header">
                    {t('dashboard.savedClosedHeading')}
                  </Text>
                  <Text variant="small" tone="mutedForeground">
                    {t('dashboard.savedClosedLede')}
                  </Text>
                </View>
                {closed.map((job) => (
                  <JobCard key={job.id} job={job} applied={applied.has(job.id)} />
                ))}
              </View>
            ) : null}
          </View>
        )}

        <View style={{ gap: space[3] }}>
          <View style={{ gap: space[1] }}>
            <Text weight="semibold" accessibilityRole="header">
              {t('savedSearch.title')}
            </Text>
            <Text variant="small" tone="mutedForeground">
              {t('savedSearch.weekly')}
            </Text>
          </View>
          <SavedSearchList searches={searches.data} />
        </View>
      </ScrollView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t('app.tabs.saved'), headerRight: bell }} />
      {body}
    </>
  );
}
