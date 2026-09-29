import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { afterCursorFilter, PAGE_SIZE, type Cursor } from '@/lib/notifications/links';
import type { NotificationRow } from '@/lib/supabase/database.types';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * The bell: the reader's own notifications, read straight from Supabase under
 * row-level security, as the website's header and /notifications page read
 * them — scoped to the reader explicitly as well, which is what lets the
 * (user_id, created_at, id) index serve the read.
 *
 * Reading and marking read are the notification read-state RPCs the app calls
 * directly (docs/mobile.md): all the logic is in SQL. Following one goes
 * through the website's openNotification, which decides where it may lead.
 */

export type FeedPage = { rows: NotificationRow[]; next: Cursor | null };

/** Unread, as the badge counts it (a folded applicant is stored read). */
export function useUnreadCount() {
  const userId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ['notifications', 'unread', userId],
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId as string)
        .is('read_at', null);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/**
 * One page of the feed, newest first: PAGE_SIZE rows keyed on the last row's
 * (created_at, id) rather than an offset, so a notification arriving while
 * somebody scrolls does not shift the next page under them. One extra row is
 * asked for to learn whether there is a page after this one.
 */
export async function feedPage(userId: string, cursor: Cursor | null): Promise<FeedPage> {
  const page = (hideFolded: boolean) => {
    let query = supabase.from('notifications').select('*').eq('user_id', userId);
    // Applicants folded into a "N new applicants" row are counted by that row.
    if (hideFolded) query = query.is('folded_into', null);
    if (cursor) query = query.or(afterCursorFilter(cursor));
    return query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE_SIZE + 1);
  };

  let { data, error } = await page(true);
  // 42703: no such column — a database migration 302 has not reached yet.
  // Nothing is folded there, so the unfiltered page is the page.
  if (error?.code === '42703') ({ data, error } = await page(false));
  if (error) throw error;

  const rows = (data ?? []) as NotificationRow[];
  const shown = rows.slice(0, PAGE_SIZE);
  const last = shown[shown.length - 1];
  return {
    rows: shown,
    next: rows.length > PAGE_SIZE && last ? { createdAt: last.created_at, id: last.id } : null,
  };
}

export function useNotificationFeed() {
  const userId = useSession().session?.user.id ?? null;
  return useInfiniteQuery({
    queryKey: ['notifications', 'feed', userId],
    enabled: Boolean(userId),
    initialPageParam: null as Cursor | null,
    queryFn: ({ pageParam }) => feedPage(userId as string, pageParam),
    getNextPageParam: (last) => last.next,
  });
}

/**
 * Mark the feed read up to the newest notification the screen showed, so one
 * that arrived after it was drawn is not swallowed unseen.
 */
export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (upTo: string | null) => {
      let { data, error } = await supabase.rpc('mark_notifications_read', { p_up_to: upTo });
      // PGRST202: a database migration 301 has not reached — the unbounded
      // form it had still marks read.
      if (error?.code === 'PGRST202') ({ data, error } = await supabase.rpc('mark_notifications_read', {}));
      if (error) throw error;
      return data ?? 0;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

/** Shown as read at once, before the server has said so: the row the reader just followed. */
export function markReadLocally(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  id: string,
) {
  const readAt = new Date().toISOString();
  let changed = false;
  queryClient.setQueryData<InfiniteData<FeedPage, Cursor | null>>(['notifications', 'feed', userId], (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            rows: page.rows.map((row) => {
              if (row.id !== id || row.read_at) return row;
              changed = true;
              return { ...row, read_at: readAt };
            }),
          })),
        }
      : data,
  );
  if (changed) {
    queryClient.setQueryData<number>(['notifications', 'unread', userId], (count) =>
      typeof count === 'number' ? Math.max(0, count - 1) : count,
    );
  }
}
