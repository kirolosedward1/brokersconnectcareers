import { useState } from 'react';
import { ActivityIndicator, RefreshControl, View } from 'react-native';
import { router, Stack, type Href } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'use-intl';
import { CheckCheck } from 'lucide-react-native';
import { canAccessCandidateArea } from '@/lib/permissions';
import type { NotificationRow } from '@/lib/supabase/database.types';
import { NotificationItem } from '~/components/notifications/notification-item';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/notice';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { markReadLocally, useMarkAllRead, useNotificationFeed, useUnreadCount } from '~/features/notifications/queries';
import { callAction } from '~/lib/api';
import { routeInside } from '~/lib/links';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

type LinkNotice = 'gone' | 'unavailable' | 'failed' | null;

/**
 * The bell's feed — the website's /notifications: newest first, a page at a
 * time as the reader scrolls, "mark all read" while anything is unread.
 *
 * Following a notification asks the website (openNotification), which marks
 * it read and decides whether its link is still one this reader may follow
 * and still points at something. The answer is a page to open, or a reason to
 * stay here — said above the feed, as the website says it.
 */
export default function NotificationsScreen() {
  const t = useTranslations();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { session, actor } = useSession();
  const userId = session?.user.id ?? null;

  const feed = useNotificationFeed();
  const unread = useUnreadCount().data ?? 0;
  const markAll = useMarkAllRead();
  const [opening, setOpening] = useState<string | null>(null);
  const [notice, setNotice] = useState<LinkNotice>(null);

  const rows = feed.data?.pages.flatMap((page) => page.rows) ?? [];
  // "Mark all read" is bounded by the newest row this screen has shown.
  const newestShown = rows[0]?.created_at ?? null;

  const open = async (row: NotificationRow) => {
    if (!userId || opening) return;
    setOpening(row.id);
    setNotice(null);
    markReadLocally(queryClient, userId, row.id);
    try {
      const result = await callAction('openNotification', { id: row.id });
      const destination = result.ok ? result.data : undefined;
      if (!destination) {
        setNotice('failed');
        return;
      }
      if ('href' in destination) {
        router.navigate(routeInside(destination.href, actor) as Href);
        return;
      }
      const reason = new URL(destination.fallback, 'https://app.invalid').searchParams.get('link');
      setNotice(reason === 'gone' || reason === 'unavailable' ? reason : null);
    } catch {
      setNotice('failed');
    } finally {
      setOpening(null);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
  };

  const header = (
    <View style={{ gap: space[3], paddingBottom: space[2] }}>
      <Text tone="mutedForeground">{t('notifications.lede')}</Text>

      {unread > 0 && newestShown ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
          <Text variant="small" tone="mutedForeground">
            {t('notifications.unreadCount', { count: unread })}
          </Text>
          <Button
            label={t('notifications.markAllRead')}
            variant="outline"
            size="sm"
            loading={markAll.isPending}
            icon={<CheckCheck size={16} color={colors.foreground} />}
            onPress={() => markAll.mutate(newestShown)}
          />
        </View>
      ) : null}

      {markAll.isError ? <Notice tone="destructive">{t('common.errorBody')}</Notice> : null}
      {notice === 'gone' ? <Notice tone="muted">{t('notifications.linkGone')}</Notice> : null}
      {notice === 'unavailable' ? <Notice tone="muted">{t('notifications.linkUnavailable')}</Notice> : null}
      {notice === 'failed' ? <Notice tone="destructive">{t('common.errorBody')}</Notice> : null}
    </View>
  );

  let body: React.ReactNode;
  if (!userId) {
    // Signed out on this screen: the feed is the account's.
    body = (
      <EmptyState
        title={t('app.account.signedOutTitle')}
        action={<Button label={t('nav.signIn')} onPress={() => router.push('/sign-in')} />}
      />
    );
  } else if (feed.isPending) body = <LoadingState />;
  else if (feed.isError && rows.length === 0) body = <ErrorState error={feed.error} onRetry={() => feed.refetch()} />;
  else if (rows.length === 0) {
    // A quiet feed is the expected state most days, so it says so and points
    // at what this person came to do.
    body = (
      <EmptyState
        title={t('notifications.empty')}
        body={t('notifications.emptyHint')}
        action={
          canAccessCandidateArea(actor) ? (
            <Button label={t('notifications.emptyCtaCandidate')} variant="outline" onPress={() => router.navigate('/jobs')} />
          ) : null
        }
      />
    );
  } else {
    body = (
      <FlashList
        data={rows}
        keyExtractor={(row) => row.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space[4], paddingBottom: space[10] }}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <NotificationItem notification={item} opening={opening === item.id} onPress={() => open(item)} />
        )}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          feed.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ marginTop: space[4] }} /> : null
        }
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching && !feed.isFetchingNextPage}
            onRefresh={() => {
              feed.refetch();
              queryClient.invalidateQueries({ queryKey: ['notifications', 'unread'] });
            }}
            tintColor={colors.primary}
          />
        }
      />
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t('notifications.title') }} />
      {body}
    </>
  );
}
