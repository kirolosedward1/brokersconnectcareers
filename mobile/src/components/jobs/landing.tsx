import { RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { EMPTY_FILTERS } from '@/lib/job-filters';
import { formatEgp, formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import type { JobTrack } from '@/lib/supabase/database.types';
import { buildLandingSlug, JOB_TRACKS } from '@/lib/taxonomy';
import { JobCard } from '~/components/jobs/job-card';
import { Button } from '~/components/ui/button';
import { Chip } from '~/components/ui/chip';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useBrowseCounts, useLanding } from '~/features/browse/queries';
import { boardQuery, filtersToParams } from '~/features/jobs/filters';
import { flattenBoard, useJobBoard } from '~/features/jobs/queries';
import { useDistricts } from '~/features/taxonomy';
import { useHasBoard } from '~/lib/use-tabs';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';

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
  const tTrack = useTranslations('track');
  const { colors } = useTheme();

  const filters = { ...EMPTY_FILTERS, tracks: [track], districtSlugs: [districtSlug] };
  const landing = useLanding(slug);
  const board = useJobBoard(boardQuery(filters));
  const counts = useBrowseCounts();
  const districts = useDistricts();
  const hasBoard = useHasBoard();

  if (landing.isPending) return <LoadingState />;
  if (landing.isError && !landing.data) {
    return <ErrorState error={landing.error} onRetry={() => landing.refetch()} />;
  }

  const { district, facts } = landing.data;
  const trackName = tTrack(track);
  const districtName = localized(locale, district.name_ar, district.name_en);
  const jobs = flattenBoard(board.data?.pages);
  const total = board.data?.pages[0]?.total ?? 0;

  const factLines: string[] = [];
  if (facts.listings > 0) {
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
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={landing.isRefetching || board.isRefetching}
            onRefresh={() => {
              landing.refetch();
              board.refetch();
            }}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[5] }}
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
                    borderRadius: radius.md,
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
          <View style={{ gap: space[2] }}>
            {jobs.slice(0, 20).map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </View>
        ) : (
          <EmptyState
            title={tJobs('empty')}
            action={hasBoard ? <Button label={tJobs('title')} variant="outline" onPress={() => router.navigate('/jobs')} /> : null}
          />
        )}

        {total > 20 && hasBoard ? (
          <Button
            label={tJobs('title')}
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
                <Chip key={sibling} label={withCount(tTrack(sibling), count)} onPress={() => open(buildLandingSlug(sibling, district.slug))} />
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
    </>
  );
}
