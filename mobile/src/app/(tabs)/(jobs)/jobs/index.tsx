import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { SlidersHorizontal } from 'lucide-react-native';
import type { SearchBarCommands } from 'react-native-screens';
import {
  activeFilterList,
  countActiveFilters,
  EMPTY_FILTERS,
  parseJobFilters,
  type JobFilters,
  type JobSort,
  type SearchParams,
} from '@/lib/job-filters';
import { formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import type { JobBoardResponse } from '@/lib/mobile-api/reads';
import { CompanyLogo } from '~/components/companies/company-logo';
import { FilterSheet } from '~/components/jobs/filter-sheet';
import { JobCard } from '~/components/jobs/job-card';
import { PopularLandings } from '~/components/jobs/popular-landings';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Chip } from '~/components/ui/chip';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useBrowseCounts } from '~/features/browse/queries';
import { boardQuery, filtersToParams, sheetFilterCount, useFilterLabel } from '~/features/jobs/filters';
import { useAppliedJobIds } from '~/features/jobs/marks';
import { flattenBoard, useJobBoard } from '~/features/jobs/queries';
import { useDistricts } from '~/features/taxonomy';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

const SORTS: JobSort[] = ['newest', 'salary', 'seats'];

/**
 * The job board — the website's /jobs.
 *
 * The filters are the route's parameters and are read by the website's own
 * parser, so /jobs?track=primary&district=new-cairo from a link, a push or the
 * home screen is the same board as on the site, in the same order, from the
 * same query. Changing a filter rewrites the parameters (router.setParams),
 * never a copy of them.
 *
 * What the reader narrowed the board by is shown as chips, each removable on
 * its own; an empty board offers the single filter to drop and what dropping
 * it brings back, counted on the server. Twenty at a time, the next twenty as
 * the end of the list comes into view.
 */
export default function BoardScreen() {
  const t = useTranslations();
  const { colors } = useTheme();
  const raw = useLocalSearchParams();
  const filters = useMemo(() => parseJobFilters(raw as SearchParams), [raw]);
  const query = boardQuery(filters);

  const board = useJobBoard(query);
  const jobs = useMemo(() => flattenBoard(board.data?.pages), [board.data]);
  const first = board.data?.pages[0];
  const applied = useAppliedJobIds(useMemo(() => jobs.map((job) => job.id), [jobs]));

  const apply = (next: JobFilters) => router.setParams(filtersToParams(next));
  const [sheetOpen, setSheetOpen] = useState(false);
  const openFilters = () => setSheetOpen(true);

  // The header's search field follows the filter, whichever way it changed:
  // typed here, carried in a link, or dropped with its chip.
  const searchBar = useRef<SearchBarCommands>(null);
  useEffect(() => {
    searchBar.current?.setText(filters.q);
  }, [filters.q]);

  const header = (
    <Stack.Screen
      options={{
        title: t('jobs.title'),
        headerLargeTitle: true,
        headerSearchBarOptions: {
          ref: searchBar,
          placeholder: t('filters.searchPlaceholder'),
          hideWhenScrolling: false,
          autoCapitalize: 'none',
          tintColor: colors.primary,
          onSearchButtonPress: (event) => apply({ ...filters, q: event.nativeEvent.text.trim().slice(0, 120) }),
          onCancelButtonPress: () => {
            if (filters.q) apply({ ...filters, q: '' });
          },
        },
      }}
    />
  );

  const sheet = (
    <FilterSheet
      visible={sheetOpen}
      filters={filters}
      onClose={() => setSheetOpen(false)}
      onApply={(next) => {
        setSheetOpen(false);
        apply(next);
      }}
    />
  );

  if (board.isPending) {
    return (
      <>
        {header}
        {sheet}
        <LoadingState />
      </>
    );
  }

  if (board.isError && !board.data) {
    return (
      <>
        {header}
        <ErrorState error={board.error} onRetry={() => board.refetch()} />
      </>
    );
  }

  return (
    <>
      {header}
      {sheet}
      <FlashList
        data={jobs}
        keyExtractor={(job) => job.id}
        renderItem={({ item }) => <JobCard job={item} applied={applied.has(item.id)} />}
        ItemSeparatorComponent={Separator}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space[4], paddingBottom: space[10] }}
        ListHeaderComponent={<BoardHeader filters={filters} first={first} apply={apply} onFilters={openFilters} />}
        ListEmptyComponent={<EmptyBoard filters={filters} first={first} apply={apply} />}
        ListFooterComponent={
          <BoardFooter
            loadingMore={board.isFetchingNextPage}
            ended={!board.hasNextPage && jobs.length > 0}
            unfiltered={countActiveFilters(filters) === 0}
          />
        }
        onEndReached={() => {
          if (board.hasNextPage && !board.isFetchingNextPage) board.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshing={board.isRefetching && !board.isFetchingNextPage}
        onRefresh={() => board.refetch()}
      />
    </>
  );
}

function Separator() {
  return <View style={{ height: space[2] }} />;
}

/**
 * One block above the listings: how many, in what order, the pinned company
 * if the board is narrowed to one, and what else it is narrowed by.
 */
function BoardHeader({
  filters,
  first,
  apply,
  onFilters,
}: {
  filters: JobFilters;
  first: JobBoardResponse | undefined;
  apply: (next: JobFilters) => void;
  onFilters: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations('jobs');
  const { colors } = useTheme();
  const labelFor = useFilterLabel(filters);
  const active = activeFilterList(filters);
  const company = first?.company;
  const inSheet = sheetFilterCount(filters);

  return (
    <View style={{ gap: space[3], marginBottom: space[3] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
        <Chip
          label={inSheet ? `${t('filters')} · ${formatNumber(inSheet, locale)}` : t('filters')}
          selected={inSheet > 0}
          icon={<SlidersHorizontal size={14} color={inSheet ? colors.primary : colors.foreground} />}
          onPress={onFilters}
        />
        <Text variant="small" tone="mutedForeground" style={{ flexGrow: 1 }} accessibilityRole="header">
          {t('resultsCount', { count: first?.total ?? 0 })}
        </Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('sortBy')} style={{ flexDirection: 'row', gap: space[1] }}>
          {SORTS.map((sort) => (
            <Chip
              key={sort}
              label={t(sort === 'newest' ? 'sortNewest' : sort === 'salary' ? 'sortSalary' : 'sortSeats')}
              selected={filters.sort === sort}
              onPress={() => apply({ ...filters, sort })}
            />
          ))}
        </View>
      </View>

      {company ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] }}>
          <CompanyLogo
            name={localized(locale, company.name_ar, company.name_en)}
            logoUrl={company.logo_url}
            seed={company.slug}
            size="sm"
          />
          <View style={{ flex: 1 }}>
            <Text weight="medium" numberOfLines={1}>
              {t('atCompany', { company: localized(locale, company.name_ar, company.name_en) })}
            </Text>
            <Text
              variant="small"
              tone="primary"
              accessibilityRole="link"
              onPress={() => router.push({ pathname: '/companies/[slug]', params: { slug: company.slug } })}
            >
              {t('companyPage')}
            </Text>
          </View>
          {/* The whole board again, page and all — the company was the narrowing. */}
          <Button label={t('allCompanies')} variant="ghost" size="sm" onPress={() => apply({ ...filters, companySlug: null })} />
        </Card>
      ) : null}

      {active.length ? (
        <View accessibilityLabel={t('filters')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {active.map((filter) => {
            const label = labelFor(filter);
            return (
              <Chip
                key={filter.key}
                label={label}
                removable
                accessibilityLabel={t('removeFilter', { name: label })}
                onPress={() => apply({ ...filters, ...filter.without })}
              />
            );
          })}
          {active.length > 1 ? (
            <Button
              label={t('clearFilters')}
              variant="ghost"
              size="sm"
              onPress={() => apply(company ? { ...EMPTY_FILTERS, companySlug: filters.companySlug } : EMPTY_FILTERS)}
            />
          ) : null}
        </View>
      ) : null}

    </View>
  );
}

/**
 * Nothing matched: which single filter is in the way. Each suggestion is a
 * real count from the server — the same query with that one filter dropped —
 * so nothing is offered that would also come back empty.
 */
function EmptyBoard({
  filters,
  first,
  apply,
}: {
  filters: JobFilters;
  first: JobBoardResponse | undefined;
  apply: (next: JobFilters) => void;
}) {
  const t = useTranslations('jobs');
  const labelFor = useFilterLabel(filters);
  const active = activeFilterList(filters);
  const byKey = new Map(active.map((filter) => [filter.key, filter]));
  const relaxations = (first?.relaxations ?? []).flatMap((relaxation) => {
    const filter = byKey.get(relaxation.key);
    return filter ? [{ filter, count: relaxation.count }] : [];
  });

  return (
    <EmptyState
      title={t('empty')}
      body={t('emptyHint')}
      action={
        <View style={{ alignItems: 'center', gap: space[3] }}>
          {relaxations.length ? (
            <View style={{ alignItems: 'center', gap: space[2] }}>
              <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center' }}>
                {t('relaxHeading')}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space[2] }}>
                {relaxations.map(({ filter, count }) => (
                  <Chip
                    key={filter.key}
                    label={t('withoutFilter', { name: labelFor(filter), count })}
                    onPress={() => apply({ ...filters, ...filter.without })}
                  />
                ))}
              </View>
            </View>
          ) : null}
          {countActiveFilters(filters) > 0 ? (
            <Button label={t('clearFilters')} variant="outline" onPress={() => apply(EMPTY_FILTERS)} />
          ) : null}
        </View>
      }
    />
  );
}

function BoardFooter({ loadingMore, ended, unfiltered }: { loadingMore: boolean; ended: boolean; unfiltered: boolean }) {
  const t = useTranslations('app.jobs');
  const { colors } = useTheme();
  const counts = useBrowseCounts();
  const districts = useDistricts();

  return (
    <View style={{ paddingTop: space[4] }}>
      {loadingMore ? <ActivityIndicator color={colors.primary} /> : null}
      {ended ? (
        <Text variant="caption" tone="mutedForeground" style={{ textAlign: 'center' }}>
          {t('endOfList')}
        </Text>
      ) : null}
      {/* On the unfiltered board only, as on the website. */}
      {unfiltered ? <PopularLandings counts={counts.data} districts={districts.data} /> : null}
    </View>
  );
}
