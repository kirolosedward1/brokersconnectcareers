import { useMemo } from 'react';
import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { Lock, UserRoundCheck } from '~/components/ui/lucide';
import { formatDate, formatList } from '@/lib/format';
import { localized } from '@/lib/locale';
import { canBrowseAgentDirectory, canShortlistAgents } from '@/lib/permissions';
import type { DistrictRow, SavedAgentCardRow } from '@/lib/supabase/database.types';
import { areaLine, CardFacts, Silhouette, TrackPills } from '~/components/directory/agent-card';
import { DirectoryClosed } from '~/components/directory/directory-closed';
import { ShortlistIcon, useShortlistToggle } from '~/components/directory/shortlist-controls';
import { Avatar } from '~/components/ui/avatar';
import { Button } from '~/components/ui/button';
import { PageFooter } from '~/components/ui/page-footer';
import { Card } from '~/components/ui/card';
import { EmptyState, ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { flattenShortlist, useShortlist, useShortlistedIds } from '~/features/directory/queries';
import { useDistricts } from '~/features/taxonomy';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useNextPage } from '~/lib/use-next-page';
import { useHiddenAgents, withoutHiddenAgents } from '~/features/moderation/hidden-agents';

/**
 * The company's shortlist — the website's /employer/talent: people worth
 * remembering, kept for the whole company rather than for one listing, with
 * who kept each and when. saved_agent_cards() decides on every read what may
 * still be shown; a consultant who has since hidden their profile is a row
 * with nothing but that fact, and the way to let them go.
 *
 * Letting somebody go takes their row away at once (the website's list does
 * the same, for the same reason: the row cannot remove itself otherwise).
 */
export default function ShortlistScreen() {
  const t = useTranslations();
  const { actor } = useSession();
  const shortlist = useShortlist();
  const nextPage = useNextPage(shortlist);
  const pull = usePullRefresh(() => shortlist.refetch());
  const ids = useShortlistedIds().data;
  const districts = useDistricts().data;
  const districtMap = useMemo(() => new Map((districts ?? []).map((row) => [row.id, row])), [districts]);
  const hiddenAgents = useHiddenAgents();
  const rows = useMemo(() => {
    // Without the consultants hidden on this phone (hidden-agents.ts).
    const all = withoutHiddenAgents(flattenShortlist(shortlist.data?.pages), hiddenAgents);
    // Until the ids are read, everything the list holds; after, only who is still kept.
    return ids ? all.filter((row) => ids.includes(row.id)) : all;
  }, [shortlist.data, ids, hiddenAgents]);
  // The whole list, not the pages loaded so far: the kept ids are all of it, and follow a removal at once —
  // without the consultants hidden on this phone, who are not in it either.
  const total = ids
    ? ids.filter((id) => !hiddenAgents.has(id)).length
    : Number(shortlist.data?.pages[0]?.[0]?.total_count ?? 0);

  const header = <Stack.Screen options={{ title: t('employer.shortlist') }} />;

  if (!canShortlistAgents(actor)) {
    return (
      <>
        {header}
        {canBrowseAgentDirectory(actor) ? <NotFoundState /> : <DirectoryClosed />}
      </>
    );
  }
  if (shortlist.isPending) {
    return (
      <>
        {header}
        <LoadingState />
      </>
    );
  }
  if (shortlist.isError && !shortlist.data) {
    return (
      <>
        {header}
        <ErrorState error={shortlist.error} onRetry={() => shortlist.refetch()} />
      </>
    );
  }

  return (
    <>
      {header}
      <FlashList
        data={rows}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => <ShortlistRow row={item} districts={districtMap} />}
        ItemSeparatorComponent={Separator}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
        ListHeaderComponent={
          <View style={{ gap: space[2], marginBottom: space[3] }}>
            <Text variant="small" tone="mutedForeground">
              {t('employer.shortlistLede')}
            </Text>
            {rows.length ? (
              <Text variant="caption" tone="mutedForeground">
                {t('jobs.resultsCount', { count: total })}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={UserRoundCheck}
            title={t('employer.shortlistEmpty')}
            body={t('employer.shortlistEmptyHint')}
            action={<Button label={t('nav.agents')} variant="outline" onPress={() => router.dismissTo('/agents')} />}
          />
        }
        ListFooterComponent={<PageFooter query={shortlist} />}
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
 * One kept consultant: the card as the directory would show it today, or — once
 * they have left the directory — no name and no link, only that they were kept.
 * Who kept them, and when, at the end: a company is a team.
 */
function ShortlistRow({ row, districts }: { row: SavedAgentCardRow; districts: Map<number, DistrictRow> }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const shortlist = useShortlistToggle(row.id);

  const name = row.is_listed ? (row.is_unlocked && row.full_name ? row.full_name : t('agents.anonymous')) : t('employer.shortlistGone');
  const headline = localized(locale, row.headline_ar, row.headline_en);
  const areaText = areaLine(row.district_ids, districts, locale);
  const years = row.years_experience != null ? t('agents.yearsExperience', { count: row.years_experience }) : null;
  const availability = row.availability ? t(`availability.${row.availability}`) : null;
  const looking = row.availability === 'actively_searching';
  const savedNote = row.saved_by_name
    ? t('employer.shortlistSavedBy', { name: row.saved_by_name, date: formatDate(row.saved_at, locale) })
    : t('employer.shortlistSavedOn', { date: formatDate(row.saved_at, locale) });

  return (
    <Card
      // By slug where the name may be shown, by id where it may not; nowhere once they have left.
      onPress={row.is_listed ? () => router.push({ pathname: '/agents/[slug]', params: { slug: row.slug ?? row.id } }) : undefined}
      accessibilityLabel={formatList(
        [name, row.is_listed && !row.is_unlocked ? t('agents.locked') : null, years, areaText, availability, savedNote].filter(
          (part): part is string => Boolean(part),
        ),
        locale,
      )}
      accessibilityActions={[{ name: 'shortlist', label: shortlist.label }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'shortlist') shortlist.toggle();
      }}
      style={{ gap: space[3] }}
    >
      <View style={{ flexDirection: 'row', gap: space[3] }}>
        {row.is_unlocked && row.full_name ? (
          <Avatar name={row.full_name} src={row.avatar_url} seed={row.slug ?? row.id} size="md" />
        ) : (
          <Silhouette />
        )}

        <View style={{ flex: 1, gap: space[1] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
            <Text weight="semibold" numberOfLines={1} tone={row.is_listed ? 'foreground' : 'mutedForeground'} style={{ flexShrink: 1 }}>
              {name}
            </Text>
            {row.is_listed && !row.is_unlocked ? <Lock size={14} color={colors.mutedForeground} /> : null}
          </View>
          {row.is_listed ? (
            headline ? (
              <Text variant="small" tone="mutedForeground" numberOfLines={2}>
                {headline}
              </Text>
            ) : null
          ) : (
            <Text variant="small" tone="mutedForeground">
              {t('employer.shortlistGoneHint')}
            </Text>
          )}
          <TrackPills tracks={row.tracks} />
        </View>

        <ShortlistIcon shortlist={shortlist} />
      </View>

      <CardFacts years={years} areas={areaText} availability={availability} looking={looking}>
        <Text variant="caption" tone="mutedForeground">
          {savedNote}
        </Text>
      </CardFacts>
    </Card>
  );
}
