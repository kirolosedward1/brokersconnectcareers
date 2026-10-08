import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale } from 'use-intl';
import {
  destinationOf,
  forgetThisPhone,
  holdsPushToken,
  notificationIdOf,
  pushAvailable,
  registerThisPhone,
  stopListeningHere,
  usePushState,
} from '~/features/push/device';
import { useUnreadCount } from '~/features/notifications/queries';
import { pushTapped, takePushTap, usePushTap } from '~/features/push/taps';
import { openWhenReady } from '~/lib/open-path';
import { clearPersonalCache } from '~/lib/personal-cache';
import { storedSession, useSession } from '~/lib/session';

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
 *   refresh, another account's email link — the phone stops listening for
 *   pushes, so a lock screen no longer shows the last person's news. The next
 *   sign-in registers it again.
 */
export function PushBridge() {
  const { ready, session, viewer, viewerLoading } = useSession();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? null;
  const hasProfile = Boolean(viewer?.profile);
  const state = usePushState().data;
  const wanted = Boolean(pushAvailable() && userId && hasProfile && state?.permission === 'granted' && !state.off);

  // The session ended, by whichever road — or another person's began without
  // a sign-out (an email link opened for another account): stop listening on
  // this phone. The last person's row is theirs to remove, and their session
  // is gone; left registered, their news kept reaching the lock screen while
  // somebody else used the app. The new person's registration, below, waits
  // for this (registerThisPhone), so runs after it — declared first, this
  // runs first.
  const previous = useRef(userId);
  useEffect(() => {
    const before = previous.current;
    previous.current = userId;
    if (!before || before === userId) return;
    stopListeningHere();
    // And the files they picked or exported, left in the cache.
    clearPersonalCache();
  }, [userId]);

  // Ended before anything here was listening: a cold start whose refresh the
  // auth server refused (signed out on the website, a password changed
  // elsewhere) clears the session before any screen mounts, so the change
  // from somebody to nobody above is never seen. A push token still held here
  // is what that person left; it goes the same way. Only once the stored
  // session is gone too: a refresh that could not be answered keeps it, and
  // the person is still signed in.
  useEffect(() => {
    if (!ready || userId) return;
    let live = true;
    (async () => {
      if (!(await holdsPushToken()) || (await storedSession())) return;
      if (!live) return;
      stopListeningHere();
      clearPersonalCache();
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [ready, userId]);

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

  // Arriving while the app is open: the bell's count and feed are stale now,
  // and so may the account be — an approval or a suspension is told this way,
  // and the screens that depend on it (the directory, the standing notice)
  // follow without waiting for the app to come back from the background. So
  // are the lists a push is most often about: a new applicant in a company's
  // inbox and pipelines, its overview and its listings' counts; a move in a
  // candidate's applications and the summary on their Home. Whatever is
  // mounted is read again (a tab left open behind another included), the
  // rest when it is next opened.
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(() => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['viewer'] });
      queryClient.invalidateQueries({ queryKey: ['employer', 'applicants'] });
      queryClient.invalidateQueries({ queryKey: ['employer', 'summary'] });
      queryClient.invalidateQueries({ queryKey: ['employer', 'trend'] });
      queryClient.invalidateQueries({ queryKey: ['employer', 'listings'] });
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['candidate'] });
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
      // One of the app's own, from this phone (a consultant search's news, features/directory/alerts.ts).
      const local = localHrefOf(response);
      if (!id && local) {
        Notifications.clearLastNotificationResponse();
        openWhenReady(local);
        return;
      }
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
      queryClient.invalidateQueries({ queryKey: ['viewer'] });
    });
  }, [tapped, known, userId, queryClient]);

  // The icon's badge follows the bell.
  const unread = useUnreadCount().data;
  useEffect(() => {
    if (!userId || unread === undefined) return;
    Notifications.setBadgeCountAsync(unread).catch(() => {});
  }, [userId, unread]);

  return null;
}

/** Where a notification the app posted itself leads: the directory only, never an address from elsewhere. */
function localHrefOf(response: Notifications.NotificationResponse | null): string | null {
  const href = (response?.notification.request.content.data as { localHref?: unknown } | undefined)?.localHref;
  return typeof href === 'string' && href.startsWith('/agents') ? href : null;
}
