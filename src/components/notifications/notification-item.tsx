import { getTranslations } from 'next-intl/server';
import { openNotification } from '@/lib/actions/notifications';
import { notificationTitle, type Translate } from '@/lib/notifications/title';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { NotificationRow } from '@/lib/supabase/database.types';
import { notificationIcon, notificationTone } from '@/components/notifications/kinds';

/**
 * One notification, rendered in the reader's language.
 *
 * The row holds data; the sentence is built here, which is the whole reason
 * the payload is not prose. The same row reads correctly in Arabic and in
 * English, and a wording change reaches every notification ever written rather
 * than only the ones created after the change.
 */

export async function NotificationItem({
  notification,
  locale,
  compact = false,
}: {
  notification: NotificationRow;
  locale: string;
  /** The bell's dropdown drops the body and the date. */
  compact?: boolean;
}) {
  const t = await getTranslations('notifications');
  const tRoot = await getTranslations();

  const { kind, payload } = notification;
  /*
    A kind this build does not know yet renders as a plain notice rather than
    taking the bell down. The database gains kinds in migrations that can reach
    production before the code that names them — migration 200's
    support_replied did exactly that — and a lookup that returned undefined
    made every page with a header throw for that reader.
  */
  const Icon = notificationIcon(kind);
  const tone = notificationTone(kind);

  // The sentence itself is shared with the mobile app and push delivery.
  const title = notificationTitle(notification, locale, tRoot as unknown as Translate);

  const body = payload.note?.trim() || null;
  const unread = !notification.read_at;

  const inner = (
    <>
      <span aria-hidden className={cn('grid size-9 shrink-0 place-items-center rounded-lg', tone)}>
        <Icon className="size-4" />
      </span>

      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm leading-snug [overflow-wrap:anywhere]', unread && 'font-medium')}>
          {title}
        </span>

        {!compact && body ? (
          <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{body}</span>
        ) : null}

        {!compact ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            {formatDate(notification.created_at, locale)}
          </span>
        ) : null}
      </span>

      {/* Unread is a dot, not a colour wash. A feed where half the rows are
          tinted is a feed with no emphasis left to give. */}
      {unread ? (
        <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
      ) : null}
    </>
  );

  /*
    A form, not a link: following a notification marks it read, which is a
    write, and the server decides at that moment whether the stored href is
    still one this reader may follow and still points at something (see
    openNotification). Posts without JavaScript too.

    Every row is followable, including one with no href — opening it marks it
    read and lands on the full feed, where its body is shown.
  */
  return (
    <form action={openNotification}>
      <input type="hidden" name="id" value={notification.id} />
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        className="flex w-full items-start gap-3 rounded-xl p-3 text-start transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {inner}
        {unread ? <span className="sr-only">{t('unread')}</span> : null}
      </button>
    </form>
  );
}
