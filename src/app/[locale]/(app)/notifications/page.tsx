import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyIllustration } from '@/components/illustration';
import { asLocale } from '@/i18n/routing';
import { NotificationItem } from '@/components/notifications/notification-item';
import { MarkAllReadButton } from '@/components/notifications/mark-all-read-button';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { raise } from '@/lib/queries/error';
import { syncMyJobNotifications } from '@/lib/actions/notifications';
import {
  PAGE_SIZE,
  afterCursorFilter,
  decodeCursor,
  encodeCursor,
} from '@/lib/notifications/links';
import type { NotificationRow } from '@/lib/supabase/database.types';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'notifications' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * The whole feed.
 *
 * One page for every role. What arrives here differs by who you are — an
 * employer gets applicants and moderation decisions, a candidate gets replies —
 * but the reading of it is the same act, and RLS already decides whose rows
 * these are, so a route per role would be three copies of one page.
 */
export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ before?: string | string[]; link?: string | string[] }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);

  const viewer = await requireProfile(locale);
  const query = await searchParams;
  const cursor = decodeCursor(query.before);
  const link = typeof query.link === 'string' ? query.link : null;

  const role = viewer.profile.role;
  if (role === 'employer' || role === 'admin') await syncMyJobNotifications();

  const supabase = await createClient();

  /*
    The error is read, not dropped. The bell in the rail carries a count from
    another call, so a failure here produced a page saying "no notifications"
    under a badge saying four.
  */
  /*
    One page at a time, never the whole history: PAGE_SIZE rows, keyed on the
    last row's (created_at, id) rather than an offset, so a notification that
    arrives while somebody is paging does not shift page two under them. One
    extra row is asked for to learn whether there is a page after this one
    without a count over the whole feed.

    The error is read, not dropped. The bell carries a count from another
    call, so a failure here produced a page saying "no notifications" under a
    badge saying four.
  */
  const page = (hideFolded: boolean) => {
    let feed = supabase
      .from('notifications')
      .select('*')
      // Scoped explicitly so the (user_id, created_at, id) index serves this;
      // notifications_select_own is still the thing that decides.
      .eq('user_id', viewer.userId);
    // Applicants folded into a "N new applicants" row are counted by that
    // row, not listed beside it (migration 302).
    if (hideFolded) feed = feed.is('folded_into', null);
    if (cursor) feed = feed.or(afterCursorFilter(cursor));
    return feed
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE + 1);
  };

  let [{ data, error }, { count: unreadCount }] = await Promise.all([
    page(true),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', viewer.userId)
      .is('read_at', null),
  ]);

  // 42703: no such column — this code has reached a database migration 302
  // has not. Nothing is folded there yet, so the unfiltered page is the page.
  if (error?.code === '42703') ({ data, error } = await page(false));

  if (error) raise(error, 'loading your notifications');

  const rows = (data ?? []) as NotificationRow[];
  const notifications = rows.slice(0, PAGE_SIZE);
  const last = notifications[notifications.length - 1];
  const nextCursor =
    rows.length > PAGE_SIZE && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;
  const unread = unreadCount ?? 0;
  // "Mark all read" is bounded by the newest row this screen shows, which is
  // only the true newest on the first page — so that is the one place it is.
  const newestShown = !cursor ? (notifications[0]?.created_at ?? null) : null;

  const t = await getTranslations('notifications');

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t('title')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('lede')}</p>
        </div>

        {unread > 0 && newestShown ? (
          <span className="inline-flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">{t('unreadCount', { count: unread })}</span>
            <MarkAllReadButton label={t('markAllRead')} upTo={newestShown} />
          </span>
        ) : null}
      </header>

      {link === 'gone' || link === 'unavailable' ? (
        <p role="status" className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm">
          {link === 'gone' ? t('linkGone') : t('linkUnavailable')}
        </p>
      ) : null}

      {notifications.length === 0 && !cursor ? (
        /*
          A quiet inbox is the expected state most days, not a fault — so it
          says so, and then points at the thing this person came to the
          product to do. "Nothing here" with no way onward is a page that can
          only be left with the back button.
        */
        <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <EmptyIllustration name="updates" />
          <p className="font-medium">{t('empty')}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {t('emptyHint')}
          </p>
          <Button asChild variant="outline" className="mt-5">
            {viewer.profile.role === 'employer' || viewer.profile.role === 'admin' ? (
              <Link href="/employer/applicants">{t('emptyCtaEmployer')}</Link>
            ) : (
              <Link href="/jobs">{t('emptyCtaCandidate')}</Link>
            )}
          </Button>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card p-2">
            {notifications.map((notification) => (
              <li key={notification.id}>
                <NotificationItem notification={notification} locale={locale} />
              </li>
            ))}
          </ul>

          {/* Forward-only, plus the way back to the top: keyset paging has no
              page numbers, and "newest" is the page anybody returns to. */}
          {cursor || nextCursor ? (
            <nav className="flex items-center justify-between gap-3">
              {cursor ? (
                <Button asChild variant="outline" className="min-h-11">
                  <Link href="/notifications">{t('newest')}</Link>
                </Button>
              ) : (
                <span />
              )}
              {nextCursor ? (
                <Button asChild variant="outline" className="min-h-11">
                  <Link href={`/notifications?before=${encodeURIComponent(nextCursor)}`}>{t('older')}</Link>
                </Button>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
