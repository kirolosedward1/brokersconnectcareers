import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, NotificationRow } from '@/lib/supabase/database.types';

/** How many rows the header bell shows. One screen, not a second feed. */
export const BELL_LIMIT = 10;

/**
 * The red count on the bell.
 *
 * Hidden when nothing is unread. Above nine it stops being a number and
 * becomes "9+", which is as wide as the circle can stay.
 */
export function bellBadge(unread: number): string | null {
  if (!Number.isFinite(unread) || unread <= 0) return null;
  const count = Math.floor(unread);
  return count > 9 ? '9+' : String(count);
}

/**
 * Drop rows the bell must not show twice.
 *
 * `folded_into` marks an applicant notice already counted inside an unread
 * "N new applicants" row (migration 302). `dedupe_key` is unique per reader
 * (migration 300); the same key twice in one read is the same event, and the
 * newer row — the query is newest first — is the one that stays.
 */
export function dedupeFeed<T extends { dedupe_key: string | null; folded_into: string | null }>(
  rows: readonly T[],
): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const row of rows) {
    if (row.folded_into) continue;
    if (row.dedupe_key) {
      if (seen.has(row.dedupe_key)) continue;
      seen.add(row.dedupe_key);
    }
    kept.push(row);
  }
  return kept;
}

type FeedError = { code?: string; message: string } | null;

/**
 * How many of this reader's rows are unread and still shown.
 *
 * A head count: no row bodies. `folded_into` is excluded, because a folded
 * applicant is already counted by the head it points at. A database that has
 * not yet gained that column (42703) is counted without the filter.
 */
export async function countUnreadNotifications(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ unread: number; error: FeedError }> {
  const countUnread = (hideFolded: boolean) => {
    let query = supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    if (hideFolded) query = query.is('folded_into', null);
    return query;
  };

  let counted = await countUnread(true);
  if ((counted.error as FeedError)?.code === '42703') counted = await countUnread(false);
  const error = counted.error as FeedError;
  return { unread: error ? 0 : (counted.count ?? 0), error };
}

/**
 * The bell's page of the feed, under the reader's own session.
 *
 * Scoped to `user_id` so the feed index serves it; RLS still decides what
 * may be seen. A database that has not yet gained `folded_into` (42703) is
 * read without that filter — nothing is folded there.
 */
export async function readNotificationFeed(
  supabase: SupabaseClient<Database>,
  userId: string,
  limit = BELL_LIMIT,
): Promise<{ rows: NotificationRow[]; unread: number; error: FeedError }> {
  const latest = (hideFolded: boolean) => {
    let query = supabase.from('notifications').select('*').eq('user_id', userId);
    if (hideFolded) query = query.is('folded_into', null);
    return query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
  };

  const [first, counted] = await Promise.all([latest(true), countUnreadNotifications(supabase, userId)]);

  let recent = first.data as NotificationRow[] | null;
  let recentError = first.error as FeedError;
  if (recentError?.code === '42703') {
    const second = await latest(false);
    recent = second.data as NotificationRow[] | null;
    recentError = second.error as FeedError;
  }

  return {
    rows: recentError ? [] : dedupeFeed(recent ?? []),
    unread: counted.unread,
    error: recentError ?? counted.error,
  };
}
