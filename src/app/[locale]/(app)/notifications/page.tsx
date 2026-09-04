import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { NotificationItem } from '@/components/notifications/notification-item';
import { MarkAllReadButton } from '@/components/notifications/mark-all-read-button';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
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
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);

  await requireProfile(locale);
  const supabase = await createClient();

  const { data } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  const notifications = (data ?? []) as NotificationRow[];
  const unread = notifications.filter((row) => !row.read_at).length;

  const t = await getTranslations('notifications');

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('lede')}</p>
        </div>

        {unread > 0 ? <MarkAllReadButton label={t('markAllRead')} /> : null}
      </header>

      {notifications.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card p-2">
          {notifications.map((notification) => (
            <li key={notification.id}>
              <NotificationItem notification={notification} locale={locale} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
