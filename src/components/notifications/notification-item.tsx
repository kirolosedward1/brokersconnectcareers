import { getTranslations } from 'next-intl/server';
import {
  BadgeCheck,
  Bell,
  CalendarClock,
  CalendarX2,
  CircleSlash,
  Eye,
  FileCheck2,
  FileWarning,
  FileX2,
  KeyRound,
  LifeBuoy,
  Send,
  UserCheck,
  UserMinus,
  UserRound,
} from 'lucide-react';
import { openNotification } from '@/lib/actions/notifications';
import { isKnownNotificationKind, notificationTitle, type Translate } from '@/lib/notifications/title';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { NotificationKind, NotificationRow } from '@/lib/supabase/database.types';

/**
 * One notification, rendered in the reader's language.
 *
 * The row holds data; the sentence is built here, which is the whole reason
 * the payload is not prose. The same row reads correctly in Arabic and in
 * English, and a wording change reaches every notification ever written rather
 * than only the ones created after the change.
 */
const ICONS: Record<NotificationKind, React.ComponentType<{ className?: string }>> = {
  application_submitted: Send,
  application_received: UserRound,
  application_withdrawn: UserMinus,
  application_moved: Send,
  job_published: FileCheck2,
  job_rejected: FileX2,
  company_verified: BadgeCheck,
  account_approved: UserCheck,
  account_rejected: CircleSlash,
  job_expiring: CalendarClock,
  job_expired: CalendarX2,
  company_verification_needed: FileWarning,
  profile_visibility_changed: Eye,
  password_changed: KeyRound,
  support_replied: LifeBuoy,
};

const TONES: Record<NotificationKind, string> = {
  application_submitted: 'bg-success-muted text-success',
  application_received: 'bg-primary/10 text-primary',
  application_withdrawn: 'bg-muted text-muted-foreground',
  application_moved: 'bg-primary/10 text-primary',
  job_published: 'bg-success-muted text-success',
  job_rejected: 'bg-destructive-muted text-destructive',
  company_verified: 'bg-success-muted text-success',
  account_approved: 'bg-success-muted text-success',
  account_rejected: 'bg-destructive-muted text-destructive',
  job_expiring: 'bg-warning-muted text-warning',
  job_expired: 'bg-muted text-muted-foreground',
  company_verification_needed: 'bg-destructive-muted text-destructive',
  profile_visibility_changed: 'bg-primary/10 text-primary',
  // A security notice reads as one: the tone a reader already knows means
  // "look at this".
  password_changed: 'bg-warning-muted text-warning',
  support_replied: 'bg-primary/10 text-primary',
};

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
  const known = isKnownNotificationKind(kind);
  const Icon = known ? ICONS[kind] : Bell;
  const tone = known ? TONES[kind] : 'bg-muted text-muted-foreground';

  // The sentence itself is shared with the mobile app and push delivery.
  const title = notificationTitle(notification, locale, tRoot as unknown as Translate);

  const body = payload.note || null;
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
