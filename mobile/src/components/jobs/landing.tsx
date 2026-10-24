import { RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { EMPTY_FILTERS } from '@/lib/job-filters';
import { formatEgp, formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import type { JobTrack } from '@/lib/supabase/database.types';
import { buildLandingSlug, JOB_TRACKS } from '@/lib/taxonomy';
import { JobCardList } from '~/components/jobs/job-card-list';
import { Button } from '~/components/ui/button';
import { Chip } from '~/components/ui/chip';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useBrowseCounts, useLanding } from '~/features/browse/queries';
import { boardQuery, filtersToParams } from '~/features/jobs/filters';
import { flattenBoard, useJobBoard } from '~/features/jobs/queries';
import { useHiddenCompanies, withoutHidden } from '~/features/moderation/hidden-companies';
import { useHiddenJobs, withoutHiddenJobs } from '~/features/moderation/hidden-jobs';
import { totalShown } from '~/features/moderation/hidden-store';
import { useDistricts } from '~/features/taxonomy';
import { useShrinkingTabBar } from '~/features/tab-bar';
import { useHasBoard } from '~/lib/use-tabs';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';
import { SearchX } from '~/components/ui/lucide';
import { usePullRefresh } from '~/lib/use-pull-refresh';

/**
 * One track in one district — the website's TrackDistrictLanding at
 * /jobs/<track>-<district>: its facts (how many companies are hiring, how
 * many listings state a basic salary and its range), its listings, and the
 * neighbouring pages that have something on them.
 */
export function TrackDistrictLanding({ slug, track, districtSlug }: { slug: string; track: JobTrack; districtSlug: string }) {
  const locale = useLocale();
  const t = useTranslations('landing');
  const tJobs = useTranslations('jobs');
  const tNav = useTranslations('nav');
  const tTrack = useTranslations('track');
  const { colors } = useTheme();

  const filters = { ...EMPTY_FILTERS, tracks: [track], districtSlugs: [districtSlug] };
  const landing = useLanding(slug);
  const board = useJobBoard(boardQuery(filters));
  const counts = useBrowseCounts();
  const districts = useDistricts();
  const hasBoard = useHasBoard();
  const pull = usePullRefresh(() => Promise.all([landing.refetch(), board.refetch()]));
  const shrink = useShrinkingTabBar();
  // The companies this phone hides stay hidden here too, as on the board and Home.
  const hiddenCompanies = useHiddenCompanies();
  const hiddenJobs = useHiddenJobs();

  if (landing.isPending) return <LoadingState />;
  if (landing.isError && !landing.data) {
    return <ErrorState error={landing.error} onRetry={() => landing.refetch()} />;
  }

  const { district, facts } = landing.data;
  const trackName = tTrack(track);
  const districtName = localized(locale, district.name_ar, district.name_en);
  const read = flattenBoard(board.data?.pages);
  // Without what this phone hides — a company's listings, and listings set aside one by one — as the board does,
  // so the count, the empty state and the first twenty are of what is drawn.
  const jobs = withoutHiddenJobs(withoutHidden(read, hiddenCompanies), hiddenJobs);
  const total = totalShown(board.data?.pages[0]?.total ?? 0, read.length, jobs.length);
  // More listings than the twenty drawn here, the board has the rest: once
  // this phone hides some of a first page, more than the page holds is not
  // "more than 20", and a first page all hidden is not "none".
  const more = total > Math.min(jobs.length, 20);

  const factLines: string[] = [];
  // The area's facts are the server's, of every listing: beside an empty page
  // — all there is hidden on this phone — they described listings not shown.
  const allHidden = read.length > 0 && total === 0;
  if (facts.listings > 0 && !allHidden) {
    factLines.push(t('companiesHiring', { count: facts.companies }));
    if (facts.withBasicSalary > 0) {
      factLines.push(
        t('withSalary', { count: formatNumber(facts.withBasicSalary, locale), total: formatNumber(facts.listings, locale) }),
      );
      if (facts.salaryFloor != null && facts.salaryCeiling != null && facts.salaryCeiling > facts.salaryFloor) {
        factLines.push(
          t('factSalaryRange', { min: formatEgp(facts.salaryFloor, locale), max: formatEgp(facts.salaryCeiling, locale) }),
        );
      } else if (facts.salaryFloor != null) {
        factLines.push(t('factSalaryFrom', { min: formatEgp(facts.salaryFloor, locale) }));
      }
    }
  }

  // Neighbours with something on them first, busiest first; the rest of the
  // taxonomy only fills the row — the website's rule.
  const live = new Map((counts.data?.pairs ?? []).map((pair) => [`${pair.track}:${pair.districtId}`, pair.count]));
  const liveCount = (value: JobTrack, districtId: number) => live.get(`${value}:${districtId}`) ?? 0;
  const siblingDistricts = (districts.data ?? [])
    .filter((item) => item.id !== district.id)
    .map((item) => ({ district: item, count: liveCount(track, item.id) }))
    .sort((a, b) => b.count - a.count)
    .filter((item, index) => item.count > 0 || index < 6)
    .slice(0, 12);
  const siblingTracks = JOB_TRACKS.filter((value) => value !== track)
    .map((value) => ({ track: value, count: liveCount(value, district.id) }))
    .sort((a, b) => b.count - a.count);

  const open = (next: string) => router.push({ pathname: '/jobs/[slug]', params: { slug: next } });
  const withCount = (label: string, count: number) => (count > 0 ? `${label} ${formatNumber(count, locale)}` : label);

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView
        {...shrink}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.primary} />
        }
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[5] }}
      >
        <View style={{ gap: space[2] }}>
          <Text variant="title" weight="bold" accessibilityRole="header">
            {t('title', { track: trackName, district: districtName })}
          </Text>
          <Text tone="mutedForeground">{t('subtitle', { track: trackName, district: districtName })}</Text>
          {/* Counted only once read: a failed read is not "no results". */}
          {board.data ? (
            <Text variant="small" tone="mutedForeground">
              {tJobs('resultsCount', { count: total })}
            </Text>
          ) : null}
          {factLines.length ? (
            <View accessibilityLabel={t('factsLabel')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              {factLines.map((line) => (
                <View
                  key={line}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    ...corner('md'),
                    backgroundColor: colors.card,
                    paddingHorizontal: space[2],
                    paddingVertical: space[1],
                  }}
                >
                  <Text variant="small">{line}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {board.isPending ? (
          <LoadingState />
        ) : board.isError && !board.data ? (
          // Never "no jobs here" for a read that failed.
          <ErrorState error={board.error} onRetry={() => board.refetch()} />
        ) : jobs.length ? (
          <JobCardList jobs={jobs.slice(0, 20)} />
        ) : more && hasBoard ? null : (
          <EmptyState
            icon={SearchX}
            title={tJobs('empty')}
            action={hasBoard ? <Button label={tNav('browseJobs')} variant="outline" onPress={() => router.navigate('/jobs')} /> : null}
          />
        )}

        {more && hasBoard ? (
          <Button
            label={tNav('browseJobs')}
            variant="outline"
            onPress={() => router.navigate({ pathname: '/jobs', params: filtersToParams(filters) })}
          />
        ) : null}

        <View style={{ gap: space[5], paddingTop: space[5], borderTopWidth: 1, borderTopColor: colors.border }}>
          <View style={{ gap: space[2] }}>
            <Text variant="small" weight="semibold" accessibilityRole="header">
              {t('otherDistricts', { track: trackName })}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              {siblingDistricts.map(({ district: sibling, count }) => (
                <Chip
                  key={sibling.id}
                  label={withCount(localized(locale, sibling.name_ar, sibling.name_en), count)}
                  onPress={() => open(buildLandingSlug(track, sibling.slug))}
                  feedback={false}
                />
              ))}
            </View>
          </View>

          <View style={{ gap: space[2] }}>
            <Text variant="small" weight="semibold" accessibilityRole="header">
              {t('otherTracks', { district: districtName })}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              {siblingTracks.map(({ track: sibling, count }) => (
                <Chip
                  key={sibling}
                  label={withCount(tTrack(sibling), count)}
                  onPress={() => open(buildLandingSlug(sibling, district.slug))}
                  feedback={false}
                />
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
    </>
  );
}
