import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale } from 'use-intl';
import {
  destinationOf,
  forgetThisPhone,
  notificationIdOf,
  registerThisPhone,
  stopListeningHere,
  usePushState,
} from '~/features/push/device';
import { useUnreadCount } from '~/features/notifications/queries';
import { pushTapped, takePushTap, usePushTap } from '~/features/push/taps';
import { openWhenReady } from '~/lib/open-path';
import { useSession } from '~/lib/session';

/**
 * Pushes, beside the root stack (mounted once the tab bar can be drawn):
 *
 * - Registers this phone for the person signed in, once they have a profile,
 *   when the phone allows notifications and they have not turned them off in
 *   the app — at every launch (which keeps the phone's "last seen" fresh) and
 *   whenever the token changes under the app.
 * - A push arriving while the app is open refreshes the bell.
 * - A tapped push — including the one that launched the app — is opened as the
 *   bell opens a notification (openNotification), once it is known who is
 *   signed in; signed out, the feed asks them to sign in and comes back.
 * - The app icon's badge is the bell's unread count, as the website's pushes
 *   set it.
 * - When the session ends by any road — a sign-out elsewhere, an expired
 *   refresh — the phone stops listening for pushes, so a lock screen no longer
 *   shows the last person's news. The next sign-in registers it again.
 */
export function PushBridge() {
  const { ready, session, viewer, viewerLoading } = useSession();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? null;
  const hasProfile = Boolean(viewer?.profile);
  const state = usePushState().data;
  const wanted = Boolean(userId && hasProfile && state?.permission === 'granted' && !state.off);

  // Register, and again when the token changes.
  useEffect(() => {
    if (!wanted) return;
    registerThisPhone(locale).catch(() => {});
    const subscription = Notifications.addPushTokenListener(() => {
      registerThisPhone(locale).catch(() => {});
    });
    return () => subscription.remove();
  }, [wanted, userId, locale]);

  // Turned off in the app while the database could not be told (offline): tell it now.
  const off = Boolean(userId && hasProfile && state?.off);
  useEffect(() => {
    if (off) forgetThisPhone().catch(() => {});
  }, [off, userId]);

  // Arriving while the app is open: the bell's count and feed are stale now.
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(() => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    return () => subscription.remove();
  }, [queryClient]);

  // Taps: the one that launched the app, then each one after.
  useEffect(() => {
    const launched = notificationIdOf(Notifications.getLastNotificationResponse());
    if (launched) {
      Notifications.clearLastNotificationResponse();
      pushTapped(launched);
    }
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const id = notificationIdOf(response);
      if (!id) return;
      Notifications.clearLastNotificationResponse();
      pushTapped(id);
    });
    return () => subscription.remove();
  }, []);

  const tapped = usePushTap();
  const known = ready && (!session || !viewerLoading);
  useEffect(() => {
    if (!tapped || !known) return;
    const id = takePushTap();
    if (!id) return;
    if (!userId) {
      openWhenReady('/notifications');
      return;
    }
    destinationOf(id).then((href) => {
      openWhenReady(href);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
  }, [tapped, known, userId, queryClient]);

  // The icon's badge follows the bell.
  const unread = useUnreadCount().data;
  useEffect(() => {
    if (!userId || unread === undefined) return;
    Notifications.setBadgeCountAsync(unread).catch(() => {});
  }, [userId, unread]);

  // The session ended, by whichever road: stop listening on this phone.
  const previous = useRef(userId);
  useEffect(() => {
    const before = previous.current;
    previous.current = userId;
    if (!before || userId) return;
    stopListeningHere();
  }, [userId]);

  return null;
}
