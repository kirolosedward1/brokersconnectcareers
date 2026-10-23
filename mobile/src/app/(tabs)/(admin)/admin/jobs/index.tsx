import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { localized } from '@/lib/locale';
import { AdminGate, daysSince, FlagList } from '~/components/admin/kit';
import { Badge } from '~/components/ui/badge';
import { Card } from '~/components/ui/card';
import { ForwardChevron } from '~/components/ui/icons';
import { Clock, Inbox } from '~/components/ui/lucide';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { usePendingListings, type QueueListing } from '~/features/admin/queries';
import { useTabList } from '~/features/tab-bar';
import { markupTags } from '~/i18n/rich';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/**
 * The review queue — the website's /admin/jobs: every listing waiting for a
 * decision, the longest-waiting first, with what its own words flag. A
 * listing is decided on its own screen, with its whole text in front of the
 * moderator, never from the list.
 */
export default function AdminListingsScreen() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ title: t('dashboard.statQueue') }} />
      <AdminGate>
        <Queue />
      </AdminGate>
    </>
  );
}

function Queue() {
  const t = useTranslations();
  const queue = usePendingListings();
  const pull = usePullRefresh(() => queue.refetch());
  const list = useTabList<FlashListRef<QueueListing>>();

  if (queue.isPending) return <LoadingState />;
  if (queue.isError && !queue.data) return <ErrorState error={queue.error} onRetry={() => queue.refetch()} />;
  const { rows, total } = queue.data;

  return (
    <FlashList
      {...list}
      data={rows}
      keyExtractor={(row) => row.id}
      renderItem={({ item }) => <ListingRow key={item.id} listing={item} />}
      ItemSeparatorComponent={Separator}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
      ListHeaderComponent={
        rows.length < total ? (
          <Text variant="small" tone="mutedForeground" style={{ marginBottom: space[3] }}>
            {t.markup('app.admin.showing', { shown: rows.length, total, ...markupTags })}
          </Text>
        ) : null
      }
      ListEmptyComponent={<EmptyState icon={Inbox} title={t('admin.emptyQueue')} />}
      {...pull}
    />
  );
}

function Separator() {
  return <View style={{ height: space[3] }} />;
}

function ListingRow({ listing }: { listing: QueueListing }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const title = localized(locale, listing.title_ar, listing.title_en) || t('admin.untitled');
  const days = daysSince(listing.created_at);

  return (
    <Card
      accessibilityLabel={`${title}، ${localized(locale, listing.company.name_ar, listing.company.name_en)}`}
      onPress={() => router.push({ pathname: '/admin/jobs/[id]', params: { id: listing.id } })}
      style={{ gap: space[2] }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold">{title}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
            <Text variant="small" tone="mutedForeground">
              {localized(locale, listing.company.name_ar, listing.company.name_en)}
            </Text>
            {listing.company.suspended_at ? <Badge variant="destructive" label={t('admin.suspended')} /> : null}
            {listing.company.verification_status === 'verified' ? (
              <Badge variant="success" label={t('admin.verification.verified')} />
            ) : null}
          </View>
        </View>
        <ForwardChevron size={18} color={colors.mutedForeground} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Clock size={14} color={days >= 1 ? colors.destructive : colors.mutedForeground} />
        <Text variant="caption" tone={days >= 1 ? 'destructive' : 'mutedForeground'}>
          {t('admin.waiting', { days })}
        </Text>
      </View>
      <FlagList flags={listing.flags} />
    </Card>
  );
}
