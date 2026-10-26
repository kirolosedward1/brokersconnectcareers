import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate } from '@/lib/format';
import { AdminGate, ApprovalBadge } from '~/components/admin/kit';
import { Avatar } from '~/components/ui/avatar';
import { Badge } from '~/components/ui/badge';
import { Card } from '~/components/ui/card';
import { Chip } from '~/components/ui/chip';
import { ForwardChevron } from '~/components/ui/icons';
import { SearchX, UserRoundCheck } from '~/components/ui/lucide';
import { PageFooter } from '~/components/ui/page-footer';
import { SearchField } from '~/components/ui/search-field';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { AGENTS_VIEWS, flattenAgents, useAgentList, visibilityVariant, type AgentListRow, type AgentsView } from '~/features/admin/agents';
import { useTabList } from '~/features/tab-bar';
import { useNextPage } from '~/lib/use-next-page';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/**
 * The consultant profiles — the website's /admin/agents: every profile,
 * whatever its visibility, in the views the website has, newest first, found
 * by the owner's name or the profile's slug. The directory hides and
 * anonymises; this list does not, because an admin looking into an
 * impersonation report needs to find the profile. What it still never
 * carries is a phone number or an email: those are on the owner's account
 * file, behind a reason. A row opens the profile's page, where the facts and
 * its one lever are.
 */
export default function AdminAgentsScreen() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.agents') }} />
      <AdminGate>
        <Agents />
      </AdminGate>
    </>
  );
}

/** The view a link asks for, in the website's own terms (`?visibility=` on /admin/agents); every profile otherwise. */
function viewFor(visibility: string | undefined): AgentsView {
  return (AGENTS_VIEWS as readonly string[]).includes(visibility ?? '') ? (visibility as AgentsView) : 'all';
}

function useViewLabels(): Record<AgentsView, string> {
  const t = useTranslations();
  return {
    all: t('admin.filterAll'),
    public: t('visibility.public'),
    verified_employers_only: t('visibility.verified_employers_only'),
    hidden: t('visibility.hidden'),
    restricted: t('admin.restricted'),
  };
}

function Agents() {
  const t = useTranslations();
  const params = useLocalSearchParams<{ visibility?: string; q?: string }>();
  const [view, setView] = useState<AgentsView>(() => viewFor(params.visibility));
  const [query, setQuery] = useState(() => (typeof params.q === 'string' ? params.q.trim().slice(0, 120) : ''));
  const agents = useAgentList(view, query);
  const nextPage = useNextPage(agents);
  const pull = usePullRefresh(() => agents.refetch());
  const list = useTabList<FlashListRef<AgentListRow>>();
  const rows = useMemo(() => flattenAgents(agents.data?.pages), [agents.data]);
  const labels = useViewLabels();

  let body: ReactNode = null;
  if (agents.isPending) body = <LoadingState />;
  else if (agents.isError && !agents.data) body = <ErrorState error={agents.error} onRetry={() => agents.refetch()} />;

  const header = (
    <View style={{ gap: space[3], marginBottom: space[4] }}>
      <Text variant="small" tone="mutedForeground">
        {t('admin.agentsLede')}
      </Text>
      {/* One view at a time: a radio group, as VoiceOver should say it. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        accessibilityRole="radiogroup"
        accessibilityLabel={t('admin.colVisibility')}
        contentContainerStyle={{ gap: space[2] }}
      >
        {AGENTS_VIEWS.map((option) => (
          <Chip key={option} radio label={labels[option]} selected={option === view} onPress={() => setView(option)} />
        ))}
      </ScrollView>
    </View>
  );

  return (
    // The search, over whatever is below it, so the words stay in view while their answer comes.
    <View style={{ flex: 1 }}>
      <SearchField
        value={query}
        label={t('filters.search')}
        placeholder={t('admin.agentsSearchPlaceholder')}
        onSearch={setQuery}
        style={{ marginHorizontal: gutter, marginTop: space[2], marginBottom: space[1] }}
      />
      <FlashList
        {...list}
        data={body ? [] : rows}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => <AgentRow key={item.id} agent={item} />}
        ItemSeparatorComponent={Separator}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          body ??
          // A search that found nobody says so; a view with nobody in it is a list that is clear.
          (query ? (
            <EmptyState icon={SearchX} title={t('admin.searchNothing')} />
          ) : (
            <EmptyState icon={UserRoundCheck} title={t('admin.emptyQueue')} />
          ))
        }
        ListFooterComponent={<PageFooter query={agents} />}
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

/** One profile: the owner, the slug, the years, the availability, the account's standing, and how it is seen. */
function AgentRow({ agent }: { agent: AgentListRow }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const restricted = Boolean(agent.restricted_at);

  return (
    <Card
      accessibilityLabel={`${agent.profile.full_name}، ${agent.slug}`}
      onPress={() => router.push({ pathname: '/admin/agents/[id]', params: { id: agent.id } })}
      style={{ gap: space[3] }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <Avatar name={agent.profile.full_name} src={agent.profile.avatar_url} seed={agent.id} size="md" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold">{agent.profile.full_name}</Text>
          {/* The slug as written, left to right. */}
          <Text variant="caption" tone="mutedForeground" style={{ writingDirection: 'ltr', textAlign: 'left' }}>
            {agent.slug}
          </Text>
          <Text variant="small" tone="mutedForeground">
            {`${t('admin.yearsN', { count: agent.years_experience })} · ${t(`availability.${agent.availability}`)}`}
          </Text>
          <Text variant="caption" tone="mutedForeground">
            {`${t('admin.colJoined')}: ${formatDate(agent.created_at, locale)}`}
          </Text>
        </View>
        <ForwardChevron size={18} color={colors.mutedForeground} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
        <ApprovalBadge status={agent.profile.approval_status} />
        <Badge
          variant={visibilityVariant(agent.visibility, restricted)}
          label={restricted ? t('admin.restricted') : t(`visibility.${agent.visibility}`)}
        />
      </View>
    </Card>
  );
}
