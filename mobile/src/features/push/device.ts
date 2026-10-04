import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useQuery } from '@tanstack/react-query';
import { forgetOnboardingIntent } from '~/features/auth/kept-intent';
import { callAction } from '~/lib/api';
import { useSession } from '~/lib/session';
import { encryptedSessionStorage } from '~/lib/session-storage';
import { SESSION_KEY, supabase } from '~/lib/supabase';

/**
 * This phone's part in pushes (docs/mobile.md, "Pushes"). The website sends
 * them — one per bell notification, in the phone's language, with the unread
 * count as the badge — to every phone registered for the person. The app's
 * part: registering this phone's Expo token for whoever is signed in
 * (register_push_device, which moves a token to the new person when somebody
 * else signs in on the phone), forgetting it before signing out
 * (unregister_push_device), and opening what a push is about.
 *
 * Permission is asked for at a moment with a reason — the prompt on Home, or
 * the switch in the account — never at launch. Somebody may also turn pushes
 * off here without going to the phone's settings; that choice is kept per
 * person on this phone.
 */

/** The Expo token last registered from this phone, to forget it at sign-out. */
const TOKEN_KEY = 'push:token';
const offKey = (userId: string) => `push:off:${userId}`;
const promptKey = (userId: string) => `push:prompt-dismissed:${userId}`;

/** The last stop (stopListeningHere), for a registration to wait for. */
let stopping: Promise<void> = Promise.resolve();

/** What the database accepts for a version (push_devices_app_version_check). */
const APP_VERSION = /^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$/;

export type PushPermission = 'granted' | 'denied' | 'undetermined';

export type PushState = {
  permission: PushPermission;
  /** Turned off in the app by this person, on this phone. */
  off: boolean;
  /** The prompt on Home was answered "not now". */
  promptDismissed: boolean;
};

// A push that arrives while the app is open still shows, quietly: the bell
// counts it too, but a banner is how somebody in another tab hears of it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

// The channel the website names for Android (compose.ts); iOS has none.
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'Brokers Connect',
    importance: Notifications.AndroidImportance.HIGH,
  }).catch(() => {});
}

/**
 * Whether this build can have a push token at all.
 *
 * Expo's push service issues one only for an EAS project (app.config.ts,
 * extra.eas.projectId), and none is set up yet; Expo Go running this project
 * has none either. On Android the token comes through Firebase as well, which
 * a build has only when it was given google-services.json (app.config.ts,
 * android.googleServicesFile). Without them, the phone could be asked and say
 * yes, the token would never come, and the switch would read "on" for
 * nothing. So pushes are not offered: no prompt on Home, a sentence in the
 * account instead of the switch, and nothing registered or unregistered.
 */
export function pushAvailable(): boolean {
  const project = Boolean(Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId);
  return project && (Platform.OS !== 'android' || Boolean(Constants.expoConfig?.android?.googleServicesFile));
}

/** Whether the phone lets the app notify: provisional and ephemeral count as yes. */
export async function readPermission(): Promise<PushPermission> {
  const answer = await Notifications.getPermissionsAsync();
  const ios = answer.ios?.status;
  if (
    answer.granted ||
    ios === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    ios === Notifications.IosAuthorizationStatus.EPHEMERAL
  ) {
    return 'granted';
  }
  return answer.status === 'denied' ? 'denied' : 'undetermined';
}

/** The system's question, asked once; the answer as readPermission gives it. */
export async function askPermission(): Promise<PushPermission> {
  await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
  return readPermission();
}

/**
 * This phone's token, registered for the person signed in, in the language
 * the app speaks. Throws when there is no token to be had (no EAS project in
 * a development build, no network) or the database refused it.
 */
export async function registerThisPhone(locale: string): Promise<string> {
  // A stop on its way for the person before finishes first, so Apple's
  // registration is not undone under the new one.
  await stopping;
  const { data: token } = await Notifications.getExpoPushTokenAsync();
  const version = Application.nativeApplicationVersion;
  const { error } = await supabase.rpc('register_push_device', {
    p_token: token,
    p_platform: Platform.OS === 'android' ? 'android' : 'ios',
    p_locale: locale === 'en' ? 'en' : 'ar',
    p_app_version: version && APP_VERSION.test(version) ? version : null,
  });
  if (error) throw error;
  await AsyncStorage.setItem(TOKEN_KEY, token);
  return token;
}

/**
 * Stop this phone hearing about the person signed in. Needs their session —
 * the database removes only the caller's own row — so it runs before a
 * sign-out, never after.
 */
export async function forgetThisPhone(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  const { error } = await supabase.rpc('unregister_push_device', { p_token: token });
  if (error) throw error;
  // Only once the database has let go: kept, a failed attempt is tried again.
  await AsyncStorage.removeItem(TOKEN_KEY);
}

/**
 * After a session has ended — however it ended — this phone stops listening
 * for pushes altogether (Apple's registration, not only the database's row,
 * which a session that is already gone can no longer remove), and the icon's
 * count goes. The next sign-in registers the phone again.
 */
/** Whether this phone still holds a push token, which only a signed-in person's registration leaves. */
export async function holdsPushToken(): Promise<boolean> {
  return Boolean(await AsyncStorage.getItem(TOKEN_KEY).catch(() => null));
}

export function stopListeningHere(): Promise<void> {
  stopping = (async () => {
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
    await Notifications.setBadgeCountAsync(0).catch(() => false);
    // What was delivered for the person leaving stays in Notification Center
    // otherwise — an application's outcome, readable by whoever has the phone
    // next. Setting the badge to nought leaves those alone.
    await Notifications.dismissAllNotificationsAsync().catch(() => {});
    // Never registered without a project; and in Expo Go the registration is
    // Expo Go's own, for every project it opens.
    if (pushAvailable()) await Notifications.unregisterForNotificationsAsync().catch(() => {});
  })();
  return stopping;
}


/** Give up waiting after this long: signing out must never hang on the network. */
const FORGET_TIMEOUT_MS = 4000;
const SIGN_OUT_TIMEOUT_MS = 3000;

/**
 * Sign out on this phone, having first told the database to stop sending
 * this person's pushes here (best effort: offline, the sign-out still
 * happens, and the phone stops listening for pushes — see PushBridge).
 *
 * Signing out always works. supabase-js first tries to refresh an expired
 * session, and offline that fails and the sign-out with it — the session
 * kept, no SIGNED_OUT, the button doing nothing on a phone somebody may be
 * handing on. Then the stored session is taken out by hand, and signing out
 * again, with nothing stored, needs no network and says so.
 *
 * Nor does it wait out supabase-js's retries. With an access token that has
 * run out and no connection (or the auth service asking to wait), the
 * refresh it needs first was retried for half a minute; the sign-out is given
 * a few seconds, and then the stored session is taken out by hand as above.
 * A refresh answered after that is discarded by supabase-js, which will not
 * write over a session removed while its refresh was on the way.
 */
export async function signOutHere(): Promise<void> {
  // Where onboarding was going (the door's role, the listing) was kept for
  // iOS ending the app midway, not for a person who chose to leave: signed
  // in again, onboarding asks afresh rather than fix the role it was given.
  await forgetOnboardingIntent();
  await Promise.race([
    forgetThisPhone().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, FORGET_TIMEOUT_MS)),
  ]);
  const { error } = await Promise.race([
    supabase.auth.signOut({ scope: 'local' }).catch((failure: unknown) => ({ error: failure })),
    new Promise<{ error: string }>((resolve) => setTimeout(() => resolve({ error: 'no answer' }), SIGN_OUT_TIMEOUT_MS)),
  ]);
  if (!error) return;
  await encryptedSessionStorage.removeItem(SESSION_KEY).catch(() => {});
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
}

/** Pushes on or off for this person on this phone, in the app (not the phone's settings). */
export async function setPushOff(userId: string, off: boolean): Promise<void> {
  if (off) await AsyncStorage.setItem(offKey(userId), '1');
  else await AsyncStorage.removeItem(offKey(userId));
}

export async function dismissPushPrompt(userId: string): Promise<void> {
  await AsyncStorage.setItem(promptKey(userId), '1');
}

/**
 * Where this phone stands, for the person signed in: re-read whenever the app
 * comes back to the front, since the answer can change in the phone's
 * settings while the app is away.
 */
export function usePushState() {
  const userId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ['push', 'state', userId],
    enabled: Boolean(userId),
    staleTime: 0,
    queryFn: async (): Promise<PushState> => {
      const [permission, off, dismissed] = await Promise.all([
        readPermission().catch((): PushPermission => 'undetermined'),
        AsyncStorage.getItem(offKey(userId as string)),
        AsyncStorage.getItem(promptKey(userId as string)),
      ]);
      return { permission, off: off === '1', promptDismissed: dismissed === '1' };
    },
  });
}

/** The notification a push is about, if it names one (compose.ts sends `notificationId`). */
export function notificationIdOf(response: Notifications.NotificationResponse | null | undefined): string | null {
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  const id = response.notification.request.content.data?.notificationId;
  return typeof id === 'string' ? id : null;
}

/**
 * Where a tapped push leads — the website's openNotification, as the bell's
 * feed asks it: it marks the notification read and decides whether its link
 * is still one this person may follow. A link that is not (gone, no longer
 * theirs) opens the feed with the reason, which the feed says, as it does for
 * a tap in the bell; anything else opens the feed, where the notification is.
 */
export async function destinationOf(notificationId: string): Promise<string> {
  try {
    const result = await callAction('openNotification', { id: notificationId });
    if (result.ok && result.data && 'href' in result.data) return result.data.href;
    if (result.ok && result.data && 'fallback' in result.data && result.data.fallback.startsWith('/notifications')) {
      return result.data.fallback;
    }
  } catch {
    // Offline, or the website down: the feed, which says so itself.
  }
  return '/notifications';
}
