import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate, formatNumber } from '@/lib/format';
import { displayJobStatus } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import type { JobStatus } from '@/lib/supabase/database.types';
import { AdminGate, daysSince, FlagList } from '~/components/admin/kit';
import { Badge } from '~/components/ui/badge';
import { Card } from '~/components/ui/card';
import { Chip } from '~/components/ui/chip';
import { ForwardChevron } from '~/components/ui/icons';
import { Clock, Flag, Inbox, SearchX, Star } from '~/components/ui/lucide';
import { PageFooter } from '~/components/ui/page-footer';
import { SearchField } from '~/components/ui/search-field';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import {
  applicantsOf,
  flattenListings,
  LISTINGS_VIEWS,
  useListings,
  UUID,
  type ListingRow,
  type ListingsView,
} from '~/features/admin/listings';
import { useTabList } from '~/features/tab-bar';
import { useNextPage } from '~/lib/use-next-page';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

const STATUS_VARIANT: Record<JobStatus, 'default' | 'outline' | 'success' | 'warning' | 'destructive'> = {
  draft: 'outline',
  pending_review: 'warning',
  active: 'success',
  expired: 'default',
  closed: 'default',
  rejected: 'destructive',
};

/**
 * The listings — the website's /admin/jobs: every listing by stage, in the
 * website's views, the review queue first and the longest-waiting at its top,
 * with what each waiting listing's own words flag. Searched by title, slug or
 * id, narrowed to one company when a link asks, twenty-five at a time. A
 * listing is decided on its own screen, with its whole text in front of the
 * moderator, never from the list.
 */
export default function AdminListingsScreen() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.jobsQueue') }} />
      <AdminGate>
        <Listings />
      </AdminGate>
    </>
  );
}

/** The view a link asks for, in the website's own terms (`?status=` on /admin/jobs); the review queue otherwise. */
function viewFor(status: string | undefined): ListingsView {
  return (LISTINGS_VIEWS as readonly string[]).includes(status ?? '') ? (status as ListingsView) : 'pending';
}

function Listings() {
  const t = useTranslations();
  const params = useLocalSearchParams<{ status?: string; company?: string; q?: string }>();
  const [view, setView] = useState<ListingsView>(() => viewFor(params.status));
  const [query, setQuery] = useState(() => (typeof params.q === 'string' ? params.q.trim().slice(0, 120) : ''));
  const [companyId, setCompanyId] = useState<string | null>(() =>
    typeof params.company === 'string' && UUID.test(params.company) ? params.company : null,
  );
  const listings = useListings({ view, query, companyId });
  const nextPage = useNextPage(listings);
  const pull = usePullRefresh(() => listings.refetch());
  const list = useTabList<FlashListRef<ListingRow>>();
  const rows = useMemo(() => flattenListings(listings.data?.pages), [listings.data]);

  let body: ReactNode = null;
  if (listings.isPending) body = <LoadingState />;
  else if (listings.isError && !listings.data) body = <ErrorState error={listings.error} onRetry={() => listings.refetch()} />;

  const header = (
    <View style={{ gap: space[3], marginBottom: space[4] }}>
      <Text variant="small" tone="mutedForeground">
        {t('admin.jobsQueueLede')}
      </Text>
      {/* One view at a time: a radio group, as VoiceOver should say it. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        accessibilityRole="radiogroup"
        accessibilityLabel={t('admin.colStatus')}
        contentContainerStyle={{ gap: space[2] }}
      >
        {LISTINGS_VIEWS.map((option) => (
          <Chip key={option} radio label={t(`admin.jobView.${option}`)} selected={option === view} onPress={() => setView(option)} />
        ))}
      </ScrollView>
      {companyId ? (
        // One company's listings, as the link that brought the admin here asked; dropped with its chip.
        <View style={{ flexDirection: 'row' }}>
          <Chip removable label={t('app.admin.listings.oneCompany')} onPress={() => setCompanyId(null)} />
        </View>
      ) : null}
      {view === 'quiet' ? (
        <Text variant="small" tone="mutedForeground">
          {t('admin.quietHint')}
        </Text>
      ) : null}
    </View>
  );

  return (
    // The search, over whatever is below it, so the words stay in view while their answer comes.
    <View style={{ flex: 1 }}>
      <SearchField
        value={query}
        label={t('filters.search')}
        placeholder={t('admin.jobsSearchPlaceholder')}
        onSearch={setQuery}
        style={{ marginHorizontal: gutter, marginTop: space[2], marginBottom: space[1] }}
      />
      <FlashList
        {...list}
        data={body ? [] : rows}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => <ListingRowCard key={item.id} listing={item} view={view} />}
        ItemSeparatorComponent={Separator}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          body ??
          // A search that found nothing says so; a view with nothing in it is a queue that is clear.
          (query ? <EmptyState icon={SearchX} title={t('admin.searchNothing')} /> : <EmptyState icon={Inbox} title={t('admin.emptyQueue')} />)
        }
        ListFooterComponent={<PageFooter query={listings} />}
        onEndReached={nextPage}
        onEndReachedThreshold={0.5}
        {...pull}
      />
    </View>
  );
}

function Separator() {
  return <View style={{ height: space[3] }} />;
}

/**
 * One listing in the list, with the website's columns: the title, the
 * company (and whether it is suspended), how long it has waited or when it
 * expires or its date, how many applied, its status, whether it is featured,
 * its flags in the waiting views, and its open reports in the reported view.
 */
function ListingRowCard({ listing, view }: { listing: ListingRow; view: ListingsView }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const title = localized(locale, listing.title_ar, listing.title_en) || t('admin.untitled');
  const company = localized(locale, listing.company.name_ar, listing.company.name_en);
  const shown = displayJobStatus(listing);
  const days = daysSince(listing.created_at);
  const openReports = listing.open_reports?.length ?? 0;

  return (
    <Card
      accessibilityLabel={`${title}، ${company}`}
      onPress={() => router.push({ pathname: '/admin/jobs/[id]', params: { id: listing.id } })}
      style={{ gap: space[2] }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold">{title}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
            <Text variant="small" tone="mutedForeground">
              {company}
            </Text>
            {listing.company.suspended_at ? <Badge variant="destructive" label={t('admin.suspended')} /> : null}
          </View>
        </View>
        <ForwardChevron size={18} color={colors.mutedForeground} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[1] }}>
        <Badge variant={STATUS_VARIANT[shown]} label={t(`jobStatus.${shown}`)} />
        {listing.is_featured ? (
          <View accessible accessibilityRole="image" accessibilityLabel={t('admin.featured')}>
            <Star size={14} color={colors.warning} />
          </View>
        ) : null}
        {openReports ? (
          <Badge variant="destructive" icon={<Flag size={12} color={colors.destructive} />} label={formatNumber(openReports, locale)} />
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space[3], rowGap: 2 }}>
        {view === 'pending' || view === 'flagged' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Clock size={14} color={days >= 1 ? colors.destructive : colors.mutedForeground} />
            <Text variant="caption" tone={days >= 1 ? 'destructive' : 'mutedForeground'}>
              {t('admin.waiting', { days })}
            </Text>
          </View>
        ) : view === 'expiring' && listing.expires_at ? (
          <Text variant="caption" tone="mutedForeground">
            {`${t('admin.colExpires')}: ${formatDate(listing.expires_at, locale)}`}
          </Text>
        ) : (
          <Text variant="caption" tone="mutedForeground">
            {`${t('admin.colDate')}: ${formatDate(listing.published_at ?? listing.created_at, locale)}`}
          </Text>
        )}
        <Text variant="caption" tone="mutedForeground">
          {`${t('admin.colApplicants')}: ${formatNumber(applicantsOf(listing, view), locale)}`}
        </Text>
      </View>

      <FlagList flags={listing.flags} />
    </Card>
  );
}
