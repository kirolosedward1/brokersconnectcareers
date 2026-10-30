import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { canAccessEmployerArea, isSuspended } from '@/lib/permissions';
import type { CompanyActivityRow } from '@/lib/supabase/database.types';
import { SignedOut } from '~/components/navigation/signed-out';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { Button } from '~/components/ui/button';
import { Chip } from '~/components/ui/chip';
import { Compass, History, Share2 } from '~/components/ui/lucide';
import { PageFooter } from '~/components/ui/page-footer';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { SuspendedState } from '~/components/ui/suspended-state';
import { Text } from '~/components/ui/text';
import { ActivityEntry } from '~/components/employer/activity-entry';
import { shareActivity, useActivityWords, useCompanyActivity } from '~/features/employer/activity';
import { useCompanyPage } from '~/features/employer/company';
import { useTabList } from '~/features/tab-bar';
import { useSession } from '~/lib/session';
import { useNextPage } from '~/lib/use-next-page';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/**
 * What the team did (Phase B 04): newest first, six months. An admin reads
 * everyone's and may narrow it to one member; anybody else on the team reads
 * their own (decided). Shared as a spreadsheet from the share sheet.
 */
export default function ActivityScreen() {
  const t = useTranslations();
  const { session, viewer, actor } = useSession();
  const header = <Stack.Screen options={{ title: t('app.activity.title') }} />;

  let body: ReactNode;
  if (!session) body = <SignedOut next="/employer/activity" />;
  else if (!viewer?.profile) body = <ViewerPending />;
  else if (!canAccessEmployerArea(actor) || !viewer.company) {
    body = <EmptyState icon={Compass} title={t('common.notFound')} body={t('common.notFoundBody')} />;
  } else if (isSuspended(actor)) body = <SuspendedState />;
  else body = <Log />;

  return (
    <>
      {header}
      {body}
    </>
  );
}

function Log() {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const page = useCompanyPage();
  const isAdmin = page.data?.isAdmin ?? false;
  const [member, setMember] = useState<string | null>(null);
  const log = useCompanyActivity(isAdmin ? member : null);
  const nextPage = useNextPage(log);
  const pull = usePullRefresh(() => log.refetch());
  const list = useTabList<FlashListRef<CompanyActivityRow>>();
  const rows = useMemo(() => log.data?.pages.flat() ?? [], [log.data]);
  const words = useActivityWords();
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const share = () => {
    setError(null);
    setSharing(true);
    shareActivity(words, locale, isAdmin ? member : null)
      .catch(() => setError(t('common.errorBody')))
      .finally(() => setSharing(false));
  };

  let state: ReactNode = null;
  if (log.isPending) state = <LoadingState />;
  else if (log.isError && !log.data) state = <ErrorState error={log.error} onRetry={() => log.refetch()} />;

  const head = (
    <View style={{ gap: space[3], marginBottom: space[4] }}>
      <Text variant="small" tone="mutedForeground">
        {isAdmin ? t('app.activity.ledeAll') : t('app.activity.ledeOwn')}
      </Text>
      {isAdmin && page.data && page.data.team.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('app.activity.member')}
          contentContainerStyle={{ gap: space[2] }}
        >
          <Chip radio label={t('app.activity.everyone')} selected={member === null} onPress={() => setMember(null)} />
          {page.data.team.map((person) => (
            <Chip
              key={person.userId}
              radio
              label={person.name ?? '—'}
              selected={member === person.userId}
              onPress={() => setMember(person.userId)}
            />
          ))}
        </ScrollView>
      ) : null}
      {rows.length ? (
        <View style={{ alignItems: 'flex-start', gap: space[1] }}>
          <Button
            label={t('app.activity.export')}
            variant="outline"
            size="sm"
            icon={<Share2 size={16} color={colors.foreground} />}
            loading={sharing}
            onPress={share}
          />
          <Text variant="caption" tone="mutedForeground">
            {t('app.activity.exportHint')}
          </Text>
        </View>
      ) : null}
      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );

  return (
    <FlashList
      {...list}
      data={state ? [] : rows}
      keyExtractor={(row) => String(row.id)}
      renderItem={({ item }) => <ActivityEntry row={item} />}
      ItemSeparatorComponent={Separator}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
      ListHeaderComponent={head}
      ListEmptyComponent={state ?? <EmptyState icon={History} title={t('app.activity.emptyTitle')} body={t('app.activity.emptyBody')} />}
      ListFooterComponent={<PageFooter query={log} />}
      onEndReached={nextPage}
      onEndReachedThreshold={0.5}
      {...pull}
    />
  );
}

function Separator() {
  return <View style={{ height: space[3] }} />;
}
