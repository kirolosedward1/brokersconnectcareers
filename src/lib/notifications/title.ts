import { localized } from '@/lib/locale';
import type { NotificationKind, NotificationRow } from '@/lib/supabase/database.types';

/**
 * The sentence a notification reads as, in the reader's language.
 *
 * The row holds data; the sentence is built at read time, which is why the
 * payload is not prose — the same row reads correctly in Arabic and in English,
 * and a wording change reaches every notification ever written. The web bell,
 * the mobile app's feed and the push sent to a phone all say the same thing
 * because all three build it here.
 *
 * `t` is a translator over the whole message catalogue — next-intl's
 * `getTranslations()` with no namespace on the web, use-intl's
 * `createTranslator()` in the app — so this file imports neither.
 */

export type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The kinds this build knows how to word. A record rather than a list so the
 * compiler refuses a new NotificationKind until it is added here.
 */
const KNOWN: Record<NotificationKind, true> = {
  application_submitted: true,
  application_received: true,
  application_withdrawn: true,
  application_moved: true,
  job_published: true,
  job_rejected: true,
  company_verified: true,
  account_approved: true,
  account_rejected: true,
  job_expiring: true,
  job_expired: true,
  company_verification_needed: true,
  profile_visibility_changed: true,
  password_changed: true,
  support_replied: true,
};

/**
 * Whether this build has words for the kind.
 *
 * A kind this build does not know yet renders as a plain notice rather than
 * failing. The database gains kinds in migrations that can reach production
 * before the code that names them — migration 200's support_replied did
 * exactly that — and for the app the gap is longer still: an installed build
 * cannot be hot-fixed when a migration adds a kind.
 */
export function isKnownNotificationKind(kind: string): kind is NotificationKind {
  return Object.prototype.hasOwnProperty.call(KNOWN, kind);
}

/** What the notification is about — a listing's title, or a company's name. */
export function notificationSubject(payload: NotificationRow['payload'], locale: string): string {
  return (
    localized(locale, payload.title_ar, payload.title_en) ||
    localized(locale, payload.name_ar, payload.name_en)
  );
}

export function notificationTitle(
  notification: Pick<NotificationRow, 'kind' | 'payload'>,
  locale: string,
  t: Translate,
): string {
  const { kind, payload } = notification;
  const subject = notificationSubject(payload, locale);

  // Most kinds are one sentence with the subject in it; these three carry a
  // second fact the sentence has to say.
  if (kind === 'application_moved') {
    return t('notifications.applicationMoved', {
      title: subject,
      status: payload.status ? t(`applicationStatus.${payload.status}`) : '',
    });
  }
  if (kind === 'application_received' && (payload.count ?? 1) > 1) {
    return t('notifications.applicationReceivedMany', { subject, count: payload.count ?? 1 });
  }
  if (kind === 'profile_visibility_changed' && payload.visibility) {
    return t('notifications.profileVisibilityChanged', {
      visibility: t(`visibility.${payload.visibility}`),
    });
  }
  return isKnownNotificationKind(kind) ? t(`notifications.${kind}`, { subject }) : t('notifications.generic');
}
