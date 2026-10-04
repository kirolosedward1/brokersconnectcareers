import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { SearchX, SlidersHorizontal } from '~/components/ui/lucide';
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
import { HeaderBell } from '~/components/notifications/header-bell';
import { PageFooter } from '~/components/ui/page-footer';
import { CompanyLogo } from '~/components/companies/company-logo';
import { FilterSheet } from '~/components/jobs/filter-sheet';
import { JobCard } from '~/components/jobs/job-card';
import { PopularLandings } from '~/components/jobs/popular-landings';
import { SaveSearchButton } from '~/components/saved/save-controls';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Chip } from '~/components/ui/chip';
import { Segmented } from '~/components/ui/segmented';
import { EmptyState, ErrorState, SkeletonList } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useBrowseCounts } from '~/features/browse/queries';
import { boardQuery, filtersToParams, sheetFilterCount, useFilterLabel } from '~/features/jobs/filters';
import { useAppliedJobIds } from '~/features/jobs/marks';
import { flattenBoard, useJobBoard } from '~/features/jobs/queries';
import { useHiddenCompanies, withoutHidden } from '~/features/moderation/hidden-companies';
import { useDistricts } from '~/features/taxonomy';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useNextPage } from '~/lib/use-next-page';

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

  const nextPage = useNextPage(board);
  // The spinner is the reader's pull, not a re-read on coming back to the app.
  const pull = usePullRefresh(() => board.refetch());
  const hidden = useHiddenCompanies();
  const jobs = useMemo(() => withoutHidden(flattenBoard(board.data?.pages), hidden), [board.data, hidden]);
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
  const clearSearch = () => {
    if (filters.q) apply({ ...filters, q: '' });
  };

  const header = (
    <Stack.Screen
      options={{
        title: t('jobs.title'),
        headerLargeTitle: true,
        headerRight: () => <HeaderBell />,
        headerSearchBarOptions: {
          ref: searchBar,
          placeholder: t('filters.searchPlaceholder'),
          hideWhenScrolling: false,
          autoCapitalize: 'none',
          tintColor: colors.primary,
          onSearchButtonPress: (event) => apply({ ...filters, q: event.nativeEvent.text.trim().slice(0, 120) }),
          // Leaving the search drops it: Cancel on iOS, the field's close on Android.
          onCancelButtonPress: clearSearch,
          onClose: clearSearch,
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
    // The filters and the order work before the first listings are in: on a
    // slow first answer they are what the reader can already use.
    return (
      <>
        {header}
        {sheet}
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
        >
          <BoardHeader
            filters={filters}
            first={undefined}
            apply={apply}
            onFilters={openFilters}
            hasResults={false}
            sponsoredShown={false}
            loading
          />
          <SkeletonList inset={false} />
        </ScrollView>
      </>
    );
  }

  if (board.isError && !board.data) {
    // The filters stay as on the way in — a filter sheet open when the read
    // failed stays open with what was chosen in it, and a narrowed board can
    // be widened rather than only tried again.
    return (
      <>
        {header}
        {sheet}
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
        >
          <BoardHeader
            filters={filters}
            first={undefined}
            apply={apply}
            onFilters={openFilters}
            hasResults={false}
            sponsoredShown={false}
            loading
          />
          <ErrorState error={board.error} onRetry={() => board.refetch()} />
        </ScrollView>
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
        // The saved search is named in a field on the board: its Save must save on the first tap.
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
        ListHeaderComponent={
          <BoardHeader
            filters={filters}
            first={first}
            apply={apply}
            onFilters={openFilters}
            hasResults={jobs.length > 0}
            sponsoredShown={jobs.some((job) => job.is_featured)}
          />
        }
        ListEmptyComponent={<EmptyBoard filters={filters} first={first} apply={apply} />}
        ListFooterComponent={
          <BoardFooter
            paging={board}
            ended={!board.hasNextPage && jobs.length > 0}
            unfiltered={countActiveFilters(filters) === 0}
          />
        }
        onEndReached={nextPage}
        onEndReachedThreshold={0.5}
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
      />
    </>
  );
}

function Separator() {
  return <View style={{ height: space[3] }} />;
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
  hasResults,
  sponsoredShown,
  loading = false,
}: {
  filters: JobFilters;
  first: JobBoardResponse | undefined;
  apply: (next: JobFilters) => void;
  onFilters: () => void;
  hasResults: boolean;
  /** A sponsored listing is among the cards drawn — not merely in the answer, which still holds a company the reader hid. */
  sponsoredShown: boolean;
  /** The first page is still on its way: no count to give yet. */
  loading?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations('jobs');
  const { colors } = useTheme();
  const labelFor = useFilterLabel(filters);
  const active = activeFilterList(filters);
  const company = first?.company;
  const inSheet = sheetFilterCount(filters);
  const searchLabel = useSearchLabel(filters, first);

  return (
    <View style={{ gap: space[3], marginBottom: space[4] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
        {loading ? (
          <View style={{ flexGrow: 1 }} />
        ) : (
          <Text variant="small" weight="medium" tone="mutedForeground" style={{ flexGrow: 1 }} accessibilityRole="header">
            {t('resultsCount', { count: first?.total ?? 0 })}
          </Text>
        )}
        <Chip
          label={inSheet ? `${t('filters')} · ${formatNumber(inSheet, locale)}` : t('filters')}
          selected={inSheet > 0}
          icon={<SlidersHorizontal size={14} color={inSheet ? colors.primaryForeground : colors.foreground} />}
          onPress={onFilters}
          feedback={false}
        />
      </View>

      <Segmented
        label={t('sortBy')}
        value={filters.sort}
        onChange={(sort) => apply({ ...filters, sort })}
        options={SORTS.map((sort) => ({
          value: sort,
          label: t(sort === 'newest' ? 'sortNewest' : sort === 'salary' ? 'sortSalary' : 'sortSeats'),
        }))}
      />

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

      {/* Only once the board is narrowed: saving the whole board is emailing it weekly. */}
      {countActiveFilters(filters) > 0 && hasResults ? (
        <SaveSearchButton key={boardQuery(filters)} query={boardQuery(filters)} defaultLabel={searchLabel} />
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
              // The pinned company is not a filter: it stays, as on the website —
              // and while the answer that names it is not in yet (loading, or
              // failed), the address's own pin is kept rather than dropped.
              onPress={() => apply(company || !first ? { ...EMPTY_FILTERS, companySlug: filters.companySlug } : EMPTY_FILTERS)}
            />
          ) : null}
        </View>
      ) : null}

      {/* Paid placement pins above every sort (the website's board says the
          same), so whoever chose "highest salary" is told why the first card
          may not be. Sponsored listings sit at the top of the first page. */}
      {sponsoredShown ? (
        <Text variant="small" tone="mutedForeground">
          {t('sponsoredFirst')}
        </Text>
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
  const searchLabel = useSearchLabel(filters, first);
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
      icon={SearchX}
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
                    feedback={false}
                  />
                ))}
              </View>
            </View>
          ) : null}
          {countActiveFilters(filters) > 0 ? (
            <Button label={t('clearFilters')} variant="outline" onPress={() => apply(EMPTY_FILTERS)} />
          ) : null}
          {/* The honest answer to "there is nothing yet": tell me when there is. */}
          {countActiveFilters(filters) > 0 ? (
            <View style={{ alignItems: 'center', gap: space[1] }}>
              <SaveSearchButton key={boardQuery(filters)} query={boardQuery(filters)} defaultLabel={searchLabel} />
              <Text variant="caption" tone="mutedForeground" style={{ textAlign: 'center' }}>
                {t('emptySaveHint')}
              </Text>
            </View>
          ) : null}
        </View>
      }
    />
  );
}

/**
 * What a saved search is called unless the reader renames it — the website's
 * default: a board pinned to one brokerage is a follow, named after it; then
 * the words searched for; then the track and the place; then "jobs".
 */
function useSearchLabel(filters: JobFilters, first: JobBoardResponse | undefined): string {
  const locale = useLocale();
  const t = useTranslations();
  const districts = useDistricts().data ?? [];

  const company = first?.company;
  if (company) return localized(locale, company.name_ar, company.name_en);
  if (filters.q) return filters.q;
  const parts: string[] = [];
  if (filters.tracks[0]) parts.push(t(`track.${filters.tracks[0]}`));
  const district = districts.find((item) => item.slug === filters.districtSlugs[0]);
  if (district) parts.push(localized(locale, district.name_ar, district.name_en));
  return parts.join(' · ') || t('jobs.title');
}

function BoardFooter({
  paging,
  ended,
  unfiltered,
}: {
  paging: ComponentProps<typeof PageFooter>['query'];
  ended: boolean;
  unfiltered: boolean;
}) {
  const t = useTranslations('app.jobs');
  const counts = useBrowseCounts();
  const districts = useDistricts();

  return (
    <View style={{ paddingTop: space[4] }}>
      <PageFooter query={paging} />
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
