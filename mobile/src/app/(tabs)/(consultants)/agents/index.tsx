import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import type { SearchBarCommands } from 'react-native-screens';
import { SearchX, ShieldCheck, SlidersHorizontal, UserRoundCheck } from '~/components/ui/lucide';
import { EMPTY_AGENT_FILTERS, parseAgentFilters, type AgentFilters } from '@/lib/agent-filters';
import { formatNumber } from '@/lib/format';
import { canBrowseAgentDirectory, canShortlistAgents, hasVerifiedCompany, isAdmin } from '@/lib/permissions';
import { AgentCard } from '~/components/directory/agent-card';
import { DirectoryClosed } from '~/components/directory/directory-closed';
import { DirectoryFilterSheet } from '~/components/directory/directory-filter-sheet';
import { useHeaderBell } from '~/components/notifications/header-bell';
import { Button } from '~/components/ui/button';
import { PageFooter } from '~/components/ui/page-footer';
import { Card } from '~/components/ui/card';
import { Chip } from '~/components/ui/chip';
import { ForwardChevron } from '~/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import {
  activeAgentFilters,
  activeFilterCount,
  agentFiltersToParams,
  sheetFilterCount,
  useAgentFilterLabel,
} from '~/features/directory/filters';
import { flattenAgents, useAgentDirectory, useShortlistedIds } from '~/features/directory/queries';
import { useCompanyPage } from '~/features/employer/company';
import { useDistricts } from '~/features/taxonomy';
import { routeInside } from '~/lib/links';
import { useSession } from '~/lib/session';
import { useVisited } from '~/lib/use-visited';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useNextPage } from '~/lib/use-next-page';
import { useHiddenAgents, withoutHiddenAgents } from '~/features/moderation/hidden-agents';
import { totalShown } from '~/features/moderation/hidden-store';

/**
 * The consultant directory — the website's /agents, for the companies that
 * hire: an approved employer or an admin. The filters are the route's
 * parameters, read by the website's own parser, so /agents?track=resale from
 * a link is the same directory as on the site; twenty-four at a time, the next
 * as the end of the list comes into view.
 *
 * A company that is not verified yet is told once why the cards have no names
 * and what to do about it: the verification papers, which a company admin
 * uploads — a recruiter is told who can.
 */
export default function DirectoryScreen() {
  const t = useTranslations();
  const bell = useHeaderBell();
  const { colors } = useTheme();
  const { actor } = useSession();
  const raw = useLocalSearchParams();
  const filters = useMemo(() => parseAgentFilters(raw as Record<string, string | string[] | undefined>), [raw]);

  // Drawn at launch behind Home by the tab bar: searched once the tab is opened.
  const visited = useVisited();
  const directory = useAgentDirectory(filters, { enabled: visited });
  const nextPage = useNextPage(directory);
  const pull = usePullRefresh(() => directory.refetch());
  // Without the consultants hidden on this phone (hidden-agents.ts).
  const hiddenAgents = useHiddenAgents();
  const read = useMemo(() => flattenAgents(directory.data?.pages), [directory.data]);
  const agents = useMemo(() => withoutHiddenAgents(read, hiddenAgents), [read, hiddenAgents]);
  const districts = useDistricts().data;
  const districtMap = useMemo(() => new Map((districts ?? []).map((row) => [row.id, row])), [districts]);
  const canShortlist = canShortlistAgents(actor);

  const apply = (next: AgentFilters) => router.setParams(agentFiltersToParams(next));
  const [sheetOpen, setSheetOpen] = useState(false);

  // The header's search field follows the words, whichever way they changed.
  const searchBar = useRef<SearchBarCommands>(null);
  useEffect(() => {
    searchBar.current?.setText(filters.q);
  }, [filters.q]);

  const header = (
    <Stack.Screen
      options={{
        title: t('nav.agents'),
        headerRight: bell,
        headerSearchBarOptions: {
          ref: searchBar,
          placeholder: t('agents.searchPlaceholder'),
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
    <DirectoryFilterSheet
      visible={sheetOpen}
      filters={filters}
      onClose={() => setSheetOpen(false)}
      onApply={(next) => {
        setSheetOpen(false);
        apply(next);
      }}
    />
  );

  // Not a reader of the directory (yet): who it is for.
  if (!canBrowseAgentDirectory(actor)) {
    return (
      <>
        {header}
        <DirectoryClosed />
      </>
    );
  }

  if (directory.isPending) {
    return (
      <>
        {header}
        {sheet}
        <LoadingState />
      </>
    );
  }

  if (directory.isError && !directory.data) {
    return (
      <>
        {header}
        <ErrorState error={directory.error} onRetry={() => directory.refetch()} />
      </>
    );
  }

  return (
    <>
      {header}
      {sheet}
      <FlashList
        data={agents}
        keyExtractor={(agent) => agent.id}
        renderItem={({ item }) => (
          <AgentCard agent={item} districts={districtMap} shortlistable={canShortlist && item.is_unlocked} />
        )}
        ItemSeparatorComponent={Separator}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
        ListHeaderComponent={
          <DirectoryHeader
            filters={filters}
            total={totalShown(directory.data?.pages[0]?.total ?? 0, read.length, agents.length)}
            apply={apply}
            onFilters={() => setSheetOpen(true)}
          />
        }
        ListEmptyComponent={
          activeFilterCount(filters) > 0 ? (
            <EmptyState
              icon={SearchX}
              title={t('agents.empty')}
              body={t('agents.emptyHint')}
              action={<Button label={t('jobs.clearFilters')} variant="outline" onPress={() => apply(EMPTY_AGENT_FILTERS)} />}
            />
          ) : (
            // Nothing narrows it: the directory itself has nobody to show yet.
            <EmptyState icon={SearchX} title={t('agents.emptyDirectory')} body={t('agents.emptyDirectoryHint')} />
          )
        }
        ListFooterComponent={<PageFooter query={directory} />}
        onEndReached={nextPage}
        onEndReachedThreshold={0.5}
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
      />
    </>
  );
}

function Separator() {
  return <View style={{ height: space[2] }} />;
}

/**
 * Above the cards: the gate, when the company is not verified; the shortlist;
 * the filters and how many they come to; and what the directory is narrowed
 * by, each removable on its own.
 */
function DirectoryHeader({
  filters,
  total,
  apply,
  onFilters,
}: {
  filters: AgentFilters;
  total: number;
  apply: (next: AgentFilters) => void;
  onFilters: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const { actor } = useSession();
  const labelFor = useAgentFilterLabel();
  const active = activeAgentFilters(filters);
  const inSheet = sheetFilterCount(filters);
  // Who is kept and still shown: a consultant hidden on this phone is in neither list.
  const hiddenAgents = useHiddenAgents();
  const shortlisted = (useShortlistedIds().data ?? []).filter((id) => !hiddenAgents.has(id)).length;

  // The gate, explained once. An admin reads everything and needs no explanation.
  const gated = !isAdmin(actor) && !hasVerifiedCompany(actor);
  // The papers are a company admin's to upload; with no company yet, making one is the first step.
  const companyAdmin = useCompanyPage({ enabled: gated }).data?.isAdmin ?? false;
  const mayVerify = !actor?.company || companyAdmin;

  return (
    <View style={{ gap: space[3], marginBottom: space[3] }}>
      <Text variant="small" tone="mutedForeground">
        {t('agents.subtitle')}
      </Text>

      {gated ? (
        // The card's own surface; the shield carries the meaning, not an outline.
        <Card style={{ gap: space[2] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <ShieldCheck size={18} color={colors.primary} />
            <Text weight="medium" style={{ flexShrink: 1 }}>
              {t('agents.locked')}
            </Text>
          </View>
          <Text variant="small" tone="mutedForeground">
            {mayVerify ? t('agents.lockedBody') : t('agents.lockedRecruiter')}
          </Text>
          {mayVerify ? (
            <View style={{ alignItems: 'flex-start' }}>
              <Button
                label={t('agents.lockedCta')}
                size="sm"
                onPress={() => router.navigate(routeInside('/employer/company', actor) as never)}
              />
            </View>
          ) : null}
        </Card>
      ) : null}

      {canShortlistAgents(actor) ? (
        <Card
          onPress={() => router.push('/employer/talent')}
          accessibilityLabel={`${t('employer.shortlist')}: ${formatNumber(shortlisted, locale)}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] }}
        >
          <UserRoundCheck size={20} color={colors.primary} />
          <Text weight="medium" style={{ flex: 1 }}>
            {t('employer.shortlist')}
          </Text>
          <Text variant="small" weight="semibold" tone="primary">
            {formatNumber(shortlisted, locale)}
          </Text>
          <ForwardChevron size={18} color={colors.mutedForeground} />
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
        <Chip
          label={inSheet ? `${t('jobs.filters')} · ${formatNumber(inSheet, locale)}` : t('jobs.filters')}
          selected={inSheet > 0}
          icon={<SlidersHorizontal size={14} color={inSheet ? colors.primaryForeground : colors.foreground} />}
          onPress={onFilters}
          feedback={false}
        />
        <Text variant="small" tone="mutedForeground" style={{ flexGrow: 1 }} accessibilityRole="header">
          {t('jobs.resultsCount', { count: total })}
        </Text>
      </View>

      {active.length ? (
        <View accessibilityLabel={t('jobs.filters')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {active.map((filter) => {
            const label = labelFor(filter);
            return (
              <Chip
                key={filter.key}
                label={label}
                removable
                accessibilityLabel={t('jobs.removeFilter', { name: label })}
                onPress={() => apply({ ...filters, ...filter.without })}
              />
            );
          })}
          {active.length > 1 ? (
            <Button label={t('jobs.clearFilters')} variant="ghost" size="sm" onPress={() => apply(EMPTY_AGENT_FILTERS)} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
