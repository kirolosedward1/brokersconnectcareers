import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useTranslations } from 'use-intl';
import type { AdminSearchKind, AdminSearchRow } from '@/lib/supabase/database.types';
import { AdminGate, SectionTitle } from '~/components/admin/kit';
import { Badge } from '~/components/ui/badge';
import { Card } from '~/components/ui/card';
import { ForwardChevron } from '~/components/ui/icons';
import { Search, SearchX } from '~/components/ui/lucide';
import { SearchField } from '~/components/ui/search-field';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { consolePath, groupResults, SEARCH_MIN, searchNeedle, useAdminSearch } from '~/features/admin/search';
import { useTabList } from '~/features/tab-bar';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { gutter, hitTarget, space } from '~/theme/tokens';

/**
 * One box for "somebody wrote to support about X" — the website's
 * /admin/search: names and titles by fragment, accounts by exact email or
 * phone (neither comes back), anything by its id; the results by kind, six of
 * each at most, each a tap from its own screen in the console.
 */
export default function AdminSearchScreen() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.search') }} />
      <AdminGate>
        <ConsoleSearch />
      </AdminGate>
    </>
  );
}

function ConsoleSearch() {
  const t = useTranslations();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ q?: string }>();
  // The words a link carried (`?q=` on /admin/search — the overview's field), as the website reads them.
  const [query, setQuery] = useState(() => (typeof params.q === 'string' ? searchNeedle(params.q) : ''));
  const results = useAdminSearch(query);
  const pull = usePullRefresh(() => results.refetch());
  const list = useTabList();
  const needle = searchNeedle(query);
  const groups = results.data ? groupResults(results.data) : null;

  let body: ReactNode;
  if (!needle) body = <EmptyState icon={Search} title={t('admin.search')} body={t('admin.searchLede')} />;
  else if (needle.length < SEARCH_MIN) body = <EmptyState icon={Search} title={t('admin.searchTooShort')} />;
  else if (results.isPending) body = <LoadingState />;
  else if (results.isError && !results.data) body = <ErrorState error={results.error} onRetry={() => results.refetch()} />;
  // Nothing found says so; a search that failed never does.
  else if (!groups || groups.length === 0) body = <EmptyState icon={SearchX} title={t('admin.searchNothing')} />;
  else {
    body = (
      <View style={{ gap: space[4] }}>
        {groups.map((group) => (
          <Card key={group.kind} style={{ gap: space[2] }}>
            <SectionTitle>{t(`admin.kind.${group.kind}`)}</SectionTitle>
            {group.rows.map((row) => (
              <ResultRow key={row.id} kind={group.kind} row={row} />
            ))}
          </Card>
        ))}
      </View>
    );
  }

  return (
    // The search, over whatever is below it, so the words stay in view while their answer comes.
    <View style={{ flex: 1 }}>
      <SearchField
        value={query}
        label={t('admin.search')}
        placeholder={t('admin.searchEverythingPlaceholder')}
        onSearch={setQuery}
        style={{ marginHorizontal: gutter, marginTop: space[2], marginBottom: space[1] }}
      />
      <ScrollView
        {...list}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
        contentContainerStyle={{ flexGrow: 1, padding: gutter, paddingBottom: space[10] }}
      >
        {body}
      </ScrollView>
    </View>
  );
}

/** Every state the search returns is an enum value: the website's words for it, or the value itself for one it does not name. */
function useStateLabel(): (kind: AdminSearchKind, state: string) => string {
  const t = useTranslations();
  return (kind, state) => {
    const key =
      kind === 'user'
        ? `admin.approval.${state}`
        : kind === 'company'
          ? state === 'suspended'
            ? 'admin.suspended'
            : `admin.verification.${state}`
          : kind === 'job'
            ? `jobStatus.${state}`
            : kind === 'agent'
              ? state === 'restricted'
                ? 'admin.restricted'
                : `visibility.${state}`
              : `applicationStatus.${state}`;
    return t.has(key as never) ? t(key as never) : state;
  };
}

function ResultRow({ kind, row }: { kind: AdminSearchKind; row: AdminSearchRow }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const stateLabel = useStateLabel();
  const label = row.label ?? row.id;
  const path = consolePath(kind, row.id);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={t('app.admin.search.resultHint')}
      onPress={() => {
        if (path) router.navigate(path as Href);
      }}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="medium" numberOfLines={1}>
          {label}
        </Text>
        {row.sublabel ? (
          <Text variant="caption" tone="mutedForeground" numberOfLines={1}>
            {row.sublabel}
          </Text>
        ) : null}
      </View>
      {row.state ? <Badge variant="outline" label={stateLabel(kind, row.state)} /> : null}
      <ForwardChevron size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}
