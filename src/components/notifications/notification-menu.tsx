import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { NotificationItem } from '@/components/notifications/notification-item';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from '@/lib/auth';
import { syncMyJobNotifications } from '@/lib/actions/notifications';
import type { NotificationRow } from '@/lib/supabase/database.types';

/**
 * The bell, its unread count, and the six most recent notifications.
 *
 * One component rather than a copy per header. The console was the only place
 * this hung, so a signed-in reader lost the bell the moment they followed a
 * link out to a job page or a company — which is most of the site, and exactly
 * where an employer is when an application arrives. The public header carries
 * it now too, and both read the same feed from the same query.
 *
 * Server-rendered, including the list: the only client part is the disclosure
 * itself, so the count and the rows are never a second source of truth living
 * in client state. NotificationItem builds its sentence from the row, which is
 * why the panel can be rendered by a server component at all.
 */
export async function NotificationMenu({ locale }: { locale: string }) {
  const t = await getTranslations('notifications');

  /*
    Read under the viewer's own session — RLS is what scopes these rows, not a
    filter written here. Six is what fits in the panel without it becoming a
    page of its own.

    Allowed to fail quietly: this is chrome on every page of the site, and a
    header that throws is a reader locked out of the page they asked for. A
    bell with no badge is the same bell.
  */
  /*
    An employer's bell catches up on listings that ended or are about to,
    first — those notices have no row change to trigger on (see
    syncMyJobNotifications). Idempotent, and cheap: one statement over one
    company's listings. A candidate has none to catch up on.
  */
  const viewer = await getViewer();
  const role = viewer?.profile?.role;
  if (role === 'employer' || role === 'admin') await syncMyJobNotifications();

  const supabase = await createClient();
  const [{ data: recent }, { count: unread }] = await Promise.all([
    supabase
      .from('notifications')
      .select('*')
      // Applicants folded into a "N new applicants" row are counted by that
      // row, not shown beside it (migration 71).
      .is('folded_into', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(6),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
  ]);
  const notifications = (recent ?? []) as NotificationRow[];

  return (
    <NotificationBell label={t('title')} unread={unread ?? 0}>
      <div className="flex items-center justify-between gap-2 border-b border-border ps-3 pe-1.5 py-1">
        <p className="text-sm font-semibold">{t('title')}</p>
        <Link
          href="/notifications"
          className="inline-flex min-h-11 items-center rounded-lg px-2.5 text-xs font-medium text-primary hover:underline"
        >
          {t('seeAll')}
        </Link>
      </div>

      {/* The list caps at 24rem, or at whatever is left below the header — the
          panel is pinned under a 56px bar on a phone, and a landscape screen is
          shorter than this list wants to be. */}
      {notifications.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="max-h-[min(24rem,calc(100vh-9rem))] overflow-y-auto p-1">
          {notifications.map((notification) => (
            <li key={notification.id}>
              <NotificationItem notification={notification} locale={locale} compact />
            </li>
          ))}
        </ul>
      )}
    </NotificationBell>
  );
}
