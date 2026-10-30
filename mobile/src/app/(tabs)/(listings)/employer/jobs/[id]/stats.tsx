import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate } from '@/lib/format';
import { displayJobStatus } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import { isSuspended } from '@/lib/permissions';
import { FigureTiles } from '~/components/dashboard/figure-tiles';
import { TrendBars } from '~/components/dashboard/trend-bars';
import { StatusActions } from '~/components/employer/status-actions';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Pencil } from '~/components/ui/lucide';
import { Segmented } from '~/components/ui/segmented';
import { ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { SuspendedState } from '~/components/ui/suspended-state';
import { Text } from '~/components/ui/text';
import { useListingStats, type ListingStats } from '~/features/employer/listing-stats';
import { markupTags } from '~/i18n/rich';
import { useSession } from '~/lib/session';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANGES = ['7', '14', '30'] as const;
type Range = (typeof RANGES)[number];

/**
 * How one listing is doing (the ListingStats board): where it stands, and
 * once it has ended the way to post it again — through review, as the
 * listings screen says — or to change it first; its views, applications and
 * the rate between them; and its applications day by day over a week, a
 * fortnight or a month. Only what the platform records is drawn: the
 * board's daily views and its category average are Phase B.
 */
export default function ListingStatsScreen() {
  const t = useTranslations();
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = typeof raw === 'string' && UUID.test(raw) ? raw : '';
  const { session, viewer, actor } = useSession();
  const stats = useListingStats(id);
  const header = <Stack.Screen options={{ title: t('app.listingStats.title') }} />;

  let body: React.ReactNode;
  if (!session || !viewer?.profile) body = <ViewerPending />;
  else if (isSuspended(actor)) body = <SuspendedState />;
  else if (!viewer.company || !id) body = <NotFoundState />;
  else if (stats.isPending) body = <LoadingState />;
  else if (stats.isError && !stats.data) body = <ErrorState error={stats.error} onRetry={() => stats.refetch()} />;
  else if (!stats.data) body = <NotFoundState />;
  else body = <Stats stats={stats.data} refetch={() => stats.refetch()} />;

  return (
    <>
      {header}
      {body}
    </>
  );
}

function Stats({ stats, refetch }: { stats: ListingStats; refetch: () => Promise<unknown> }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const pull = usePullRefresh(refetch);
  const [range, setRange] = useState<Range>('14');
  const title = localized(locale, stats.title_ar, stats.title_en);
  const shown = displayJobStatus(stats);
  const ended = shown === 'expired' || shown === 'closed';
  const days = stats.days.slice(-Number(range));
  // Out of a hundred views, to one decimal; none drawn before there is a view to divide by.
  const rate = stats.view_count > 0 ? Math.round((stats.applications / stats.view_count) * 1000) / 10 : null;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
      contentContainerStyle={{ padding: gutter, paddingBottom: space[12], gap: space[5] }}
    >
      <View style={{ gap: space[1] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
          <Text variant="headline" weight="bold" accessibilityRole="header" style={{ flexShrink: 1 }}>
            {title}
          </Text>
          <Badge label={t(`jobStatus.${shown}`)} variant={shown === 'active' ? 'success' : shown === 'pending_review' ? 'warning' : 'default'} />
        </View>
        <Text variant="small" tone="mutedForeground">
          {[
            stats.district ? localized(locale, stats.district.name_ar, stats.district.name_en) : null,
            stats.expires_at
              ? t(ended ? 'app.listingStats.endedOn' : 'app.listingStats.expiresOn', { date: formatDate(stats.expires_at, locale) })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>

      {ended ? (
        <View style={{ gap: space[3], padding: space[4], ...corner('xl'), backgroundColor: colors.accent }}>
          <Text weight="bold" style={{ color: colors.accentForeground }}>
            {t('app.listingStats.ended')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'flex-start' }}>
            <StatusActions jobId={stats.id} status={shown} title={title} />
            <Button
              label={t('app.listingStats.editFirst')}
              variant="outline"
              size="sm"
              icon={<Pencil size={16} color={colors.foreground} />}
              onPress={() => router.push(`/employer/jobs/${stats.id}/edit` as never)}
            />
          </View>
        </View>
      ) : null}

      <FigureTiles
        label={t('app.listingStats.title')}
        tiles={[
          { label: t('app.listingStats.views'), value: stats.view_count },
          { label: t('app.listingStats.applications'), value: stats.applications },
          ...(rate != null ? [{ label: t('app.listingStats.rate'), value: rate, percent: true, hint: t('app.listingStats.rateHint') }] : []),
        ]}
      />

      <View style={{ gap: space[3] }}>
        <Segmented
          label={t('app.listingStats.chart')}
          options={RANGES.map((value) => ({ value, label: t.markup(`app.listingStats.range${value}`, markupTags) }))}
          value={range}
          onChange={setRange}
        />
        <TrendBars
          title={t('app.listingStats.chart')}
          days={days.map((day) => day.d)}
          values={days.map((day) => day.applications)}
          empty={t('app.listingStats.chartEmpty')}
          totalLabel={t('app.listingStats.applications')}
        />
      </View>
    </ScrollView>
  );
}
