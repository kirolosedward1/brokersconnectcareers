import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import type { UserRole } from '@/lib/supabase/database.types';
import { FALLBACK_HREF, safeNotificationHref } from '@/lib/notifications/links';

type Client = Awaited<ReturnType<typeof createClient>>;

/** Where following a notification lands: its link, or the feed with a reason. */
export type NotificationDestination = { href: string } | { fallback: string };

/**
 * Follow one notification: mark it read, then decide where it may send its
 * reader — the stored href if they may follow it and it still points at
 * something, otherwise the feed.
 *
 * The website's bell redirects to the answer; the mobile app routes to it.
 * Both ask here, so a link the website refuses is refused in the app too.
 *
 * Three outcomes that are not the stored href:
 *
 *   not theirs      open_notification is security-invoker and RLS-scoped, so
 *                   another person's id updates nothing and returns nothing.
 *                   They land on their own feed, told nothing about the row.
 *   wrong section   the href fails the role check in links.ts — an employer
 *                   link held by somebody who is no longer an employer. The
 *                   feed, with a line saying the link is not available.
 *   gone            the listing it is about was deleted, or is no longer
 *                   visible to them. The feed, with a line saying so, rather
 *                   than a 404 that reads like the site is broken.
 */
export async function resolveNotification(
  supabase: Client,
  id: string,
  role: UserRole,
): Promise<NotificationDestination> {
  const { data, error } = await supabase.rpc('open_notification', { p_id: id });
  let row = !error ? data?.[0] : undefined;

  // PGRST202: a database migration 301 has not reached. The same two steps
  // through the reader's own session — RLS scopes both to their own row, and
  // the update guard lets read_at and nothing else change.
  if (error?.code === 'PGRST202') {
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .is('read_at', null);
    const { data: own } = await supabase
      .from('notifications')
      .select('kind, href, payload')
      .eq('id', id)
      .maybeSingle();
    row = own ?? undefined;
  }

  if (!row) return { fallback: FALLBACK_HREF };

  const href = safeNotificationHref(row.href, role);
  if (row.href && !href) return { fallback: `${FALLBACK_HREF}?link=unavailable` };
  if (!href) return { fallback: FALLBACK_HREF };

  // The deleted-target check, only where the link is to the listing itself.
  // A link to a list (/dashboard/applications, /employer/jobs) still works
  // when one thing on it is gone, and needs no round trip.
  const jobId = row.payload?.job_id;
  const slug = row.payload?.slug;
  const pointsAtJob =
    (jobId && href.startsWith(`/employer/jobs/${jobId}`)) ||
    (slug && href.split(/[?#]/)[0] === `/jobs/${slug}`);

  if (pointsAtJob && jobId) {
    // Through the reader's own session: "exists" means "exists for them".
    const { data: job } = await supabase.from('jobs').select('id').eq('id', jobId).maybeSingle();
    if (!job) return { fallback: `${FALLBACK_HREF}?link=gone` };
  }

  return { href };
}
