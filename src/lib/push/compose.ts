import { notificationTitle, type Translate } from '@/lib/notifications/title';
import type { NotificationRow, PushDeviceRow } from '@/lib/supabase/database.types';
import type { ExpoMessage } from '@/lib/push/expo';

/**
 * What a phone is sent for one notification: the bell's own sentence
 * (notificationTitle — the web bell and the app's feed say the same), in the
 * language the phone's app is set to, and nothing else from the row.
 *
 * Not the note. A rejection reason, a moderator's explanation, a decision
 * note are written for the person reading them in the app, not for a lock
 * screen anybody at the table can see; the push says what happened and the
 * app shows the rest. Not the link either: the app asks for the destination
 * when the push is opened (openNotification), which marks it read and decides,
 * at that moment, whether the link is still one this person may follow.
 *
 * The badge is the unread count, as the bell shows it. Pure.
 */
export type PushSubject = Pick<NotificationRow, 'id' | 'kind' | 'payload'>;

/** Twelve hours: Apple keeps trying a phone that is off that long, and no longer. */
const TTL_SECONDS = 12 * 60 * 60;

export function composePush(
  notification: PushSubject,
  device: Pick<PushDeviceRow, 'token' | 'locale' | 'platform'>,
  badge: number,
  t: Translate,
): ExpoMessage {
  return {
    to: device.token,
    body: notificationTitle(notification, device.locale, t),
    data: { notificationId: notification.id },
    sound: 'default',
    badge: Math.max(0, Math.floor(badge)),
    priority: 'high',
    ttl: TTL_SECONDS,
    ...(device.platform === 'android' ? { channelId: 'default' } : {}),
  };
}
