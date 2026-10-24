import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useTranslations } from 'use-intl';
import { jobIsLive } from '@/lib/job-state';
import { toast } from '~/components/feedback/toast';
import { useHeaderBell } from '~/components/notifications/header-bell';
import { CompareBar } from '~/components/saved/compare-bar';
import { SavedJobItem } from '~/components/saved/saved-job-item';
import { SavedSearchList } from '~/components/saved/saved-search-list';
import { Button } from '~/components/ui/button';
import { Illustration } from '~/components/ui/illustration';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useAppliedLast } from '~/features/jobs/marks';
import { useListMotion } from '~/components/motion/list-motion';
import { useHiddenJobs, withoutHiddenJobs } from '~/features/moderation/hidden-jobs';
import { COMPARE_MAX, COMPARE_MIN, togglePick } from '~/features/saved/compare';
import { useSavedJobs, useSavedSearches } from '~/features/saved/queries';
import { useTabList } from '~/features/tab-bar';
import { markupTags } from '~/i18n/rich';
import { haptic } from '~/lib/haptics';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';
import { Scale, UserRound } from '~/components/ui/lucide';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useAnnounce } from '~/lib/use-announce';

/**
 * What the candidate kept — the website's /dashboard/saved: the bookmarked
 * listings, the ones still hiring first and the ended ones below a heading
 * that says why (never removed behind the reader's back: the bookmark is how
 * they leave), then the saved searches and followed companies with the
 * weekly email's switch.
 *
 * Each listing carries what the candidate keeps about it on this phone — a
 * note, a reminder before it closes — and two or three of those still hiring
 * can be chosen and compared side by side (dashboard/saved/compare).
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

  const hiddenJobs = useHiddenJobs();
  // A listing set aside from its card's menu leaves this list too, as the toast says.
  const saved = useMemo(() => withoutHiddenJobs(jobs.data ?? [], hiddenJobs), [jobs.data, hiddenJobs]);
  // Still open ones first, and among them what is not yet applied to.
  const { jobs: ordered, applied } = useAppliedLast(saved);
  // A bookmark taken off: the cards close up rather than jump.
  useListMotion(ordered.map((job) => job.id));
  const open = ordered.filter((job) => jobIsLive(job));
  const closed = ordered.filter((job) => !jobIsLive(job));

  // The reminders follow each read of this list wherever it is read (features/saved/reminders-follow.ts, from PushBridge).

  // Choosing listings to compare: only those still hiring, two or three of them.
  const [comparing, setComparing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const canCompare = open.length >= COMPARE_MIN;
  const choosing = comparing && canCompare;
  // Said as choosing starts: a live region is Android's alone.
  useAnnounce(t.markup('app.saved.compare.choose', { max: COMPARE_MAX, ...markupTags }), choosing);
  // A choice taken off the list since (unsaved, hidden, closed) is no longer one.
  const chosen = picked.filter((id) => open.some((job) => job.id === id));
  const stopComparing = () => {
    setComparing(false);
    setPicked([]);
  };
  const toggle = (id: string) => {
    const next = togglePick(chosen, id);
    if (next.refused) {
      haptic.tap();
      toast.show({ message: t.markup('app.saved.compare.limit', { max: COMPARE_MAX, ...markupTags }), icon: Scale });
      return;
    }
    haptic.selection();
    setPicked(next.picked);
  };

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
      <View style={{ flex: 1 }}>
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
                <View style={{ gap: space[3] }}>
                  {/* A heading only once there is a second group to tell this one from; Compare once there are two to compare. */}
                  {closed.length || canCompare ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], minHeight: 36 }}>
                      {choosing ? (
                        <Text variant="small" weight="semibold" tone="primary" accessibilityLiveRegion="polite" style={{ flex: 1 }}>
                          {t.markup('app.saved.compare.choose', { max: COMPARE_MAX, ...markupTags })}
                        </Text>
                      ) : closed.length ? (
                        <Text variant="small" weight="semibold" tone="mutedForeground" accessibilityRole="header" style={{ flex: 1 }}>
                          {t('dashboard.savedOpenHeading')}
                        </Text>
                      ) : (
                        <View style={{ flex: 1 }} />
                      )}
                      {canCompare && !choosing ? (
                        <Button
                          label={t('app.saved.compare.start')}
                          variant="outline"
                          size="sm"
                          accessibilityHint={t.markup('app.saved.compare.startHint', { max: COMPARE_MAX, ...markupTags })}
                          icon={<Scale size={16} color={colors.foreground} />}
                          onPress={() => {
                            haptic.selection();
                            setComparing(true);
                          }}
                        />
                      ) : null}
                    </View>
                  ) : null}
                  {open.map((job) => {
                    const at = chosen.indexOf(job.id);
                    return (
                      <SavedJobItem
                        key={job.id}
                        job={job}
                        applied={applied.has(job.id)}
                        pick={choosing ? { order: at === -1 ? null : at + 1, full: chosen.length >= COMPARE_MAX, onToggle: () => toggle(job.id) } : null}
                      />
                    );
                  })}
                </View>
              ) : null}

              {closed.length ? (
                // While choosing, the ended ones stand back: only open listings are compared.
                <View
                  pointerEvents={choosing ? 'none' : 'auto'}
                  accessibilityElementsHidden={choosing}
                  importantForAccessibility={choosing ? 'no-hide-descendants' : 'auto'}
                  style={{ gap: space[3], opacity: choosing ? 0.4 : 1 }}
                >
                  <View>
                    <Text variant="small" weight="semibold" tone="mutedForeground" accessibilityRole="header">
                      {t('dashboard.savedClosedHeading')}
                    </Text>
                    <Text variant="small" tone="mutedForeground">
                      {t('dashboard.savedClosedLede')}
                    </Text>
                  </View>
                  {closed.map((job) => (
                    <SavedJobItem key={job.id} job={job} applied={applied.has(job.id)} pick={null} />
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
        {choosing ? (
          <CompareBar
            count={chosen.length}
            onCancel={stopComparing}
            onCompare={() => router.push({ pathname: '/dashboard/saved/compare', params: { ids: chosen.join(',') } })}
          />
        ) : null}
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t('app.tabs.saved'), headerRight: bell }} />
      {body}
    </>
  );
}
