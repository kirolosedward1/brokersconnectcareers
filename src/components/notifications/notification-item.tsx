import { getTranslations } from 'next-intl/server';
import {
  BadgeCheck,
  CircleSlash,
  FileCheck2,
  FileX2,
  Send,
  UserCheck,
  UserRound,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
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
  application_received: UserRound,
  application_moved: Send,
  job_published: FileCheck2,
  job_rejected: FileX2,
  company_verified: BadgeCheck,
  account_approved: UserCheck,
  account_rejected: CircleSlash,
};

const TONES: Record<NotificationKind, string> = {
  application_received: 'bg-primary/10 text-primary',
  application_moved: 'bg-primary/10 text-primary',
  job_published: 'bg-success-muted text-success',
  job_rejected: 'bg-destructive-muted text-destructive',
  company_verified: 'bg-success-muted text-success',
  account_approved: 'bg-success-muted text-success',
  account_rejected: 'bg-destructive-muted text-destructive',
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
  const tStatus = await getTranslations('applicationStatus');

  const { kind, payload } = notification;
  const Icon = ICONS[kind];

  const subject =
    localized(locale, payload.title_ar, payload.title_en) ||
    localized(locale, payload.name_ar, payload.name_en);

  const title =
    kind === 'application_moved'
      ? t('applicationMoved', {
          title: subject,
          status: payload.status ? tStatus(payload.status as never) : '',
        })
      : t(kind, { subject });

  const body = payload.note || null;
  const unread = !notification.read_at;

  const inner = (
    <>
      <span aria-hidden className={cn('grid size-9 shrink-0 place-items-center rounded-lg', TONES[kind])}>
        <Icon className="size-4" />
      </span>

      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm leading-snug', unread && 'font-medium')}>{title}</span>

        {!compact && body ? (
          <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{body}</span>
        ) : null}

        {!compact ? (
          <span className="numeral mt-1 block text-xs text-muted-foreground">
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

  const className = cn(
    'flex items-start gap-3 rounded-xl p-3 transition-colors',
    notification.href && 'hover:bg-muted',
  );

  return notification.href ? (
    <Link href={notification.href} className={className}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}
