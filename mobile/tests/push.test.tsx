import type { ReactNode } from 'react';
import { Linking, Platform, Text } from 'react-native';
import { Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ProfileRow } from '@/lib/supabase/database.types';
import { PendingPath } from '~/components/navigation/pending-path';
import { PushBridge } from '~/components/navigation/push-bridge';
import { PushPrompt } from '~/components/push/push-prompt';
import { pushAvailable, signOutHere } from '~/features/push/device';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as AlertsScreen from '../src/app/(tabs)/(account)/account/alerts';
import { authSession, authUser, mobileConfig, profile, USER_ID } from './auth-fixtures';
import { fakeServer } from './server';

/*
  Pushes on the phone: asking with a reason and registering this phone for
  the person signed in, turning them off here, what a tapped push opens
  (the one that launched the app, and one tapped while it runs), forgetting
  the phone at sign-out, and the badge — against stand-ins for the system's
  notifications, Supabase and the website.
*/

jest.mock('~/lib/session-storage', () => {
  const store = new Map<string, string>();
  return {
    encryptedSessionStorage: {
      getItem: async (key: string) => store.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: async (key: string) => {
        store.delete(key);
      },
    },
  };
});

// A build with an EAS project, the only kind that can have a push token. The
// last cases take it away, as Expo Go and a build before the project exists are.
const PROJECT = 'b1f0c2d4-0000-4000-8000-000000000001';
const mockEas: { projectId?: string } = { projectId: PROJECT };
jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  // A getter defined after the copy: in an object literal, the transform would
  // read it once, before mockEas exists.
  const constants = { ...actual.default };
  Object.defineProperty(constants, 'easConfig', { get: () => mockEas, enumerable: true });
  return { ...actual, __esModule: true, default: constants };
});

const ar = catalogues.ar;
const server = fakeServer();
const PASSWORD = 'correct-horse';
const user = authUser();
const TOKEN = 'ExponentPushToken[test-token-0001]';
const NOTIFICATION = 'n0000000-0000-4000-8000-000000000001';

const granted = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
const denied = { status: 'denied', granted: false, canAskAgain: false, expires: 'never' };

let me: ProfileRow;
let unread: number;

const warnings: string[] = [];
beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
  jest.spyOn(console, 'warn').mockImplementation((...args) => {
    warnings.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  expect(warnings.filter((warning) => warning.includes('[i18n]'))).toEqual([]);
  warnings.length = 0;
});

/** Each test's cache, fresh; a test reads the profile again through it, as the app would. */
let queryClient: QueryClient;

beforeEach(async () => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  me = { ...profile };
  unread = 0;
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
    expires: 'never',
  } as never);
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue(granted as never);
  jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(null);
  jest.mocked(Notifications.addNotificationResponseReceivedListener).mockClear();
  jest.mocked(Notifications.unregisterForNotificationsAsync).mockClear();
  jest.mocked(Notifications.setBadgeCountAsync).mockClear();
  jest.mocked(Notifications.dismissAllNotificationsAsync).mockClear();
  jest.mocked(Notifications.clearLastNotificationResponse).mockClear();

  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', () => [me]);
  server.on('HEAD /rest/v1/notifications', () => ({ body: null, headers: { 'content-range': `*/${unread}` } }));
  server.on('POST /rest/v1/rpc/register_push_device', () => 'd0000000-0000-4000-8000-000000000001');
  server.on('POST /rest/v1/rpc/unregister_push_device', () => null);
  server.on('POST /api/mobile/v1/actions/openNotification', { ok: true, data: { href: '/dashboard/applications' } });

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
  await rememberActor({ userId: USER_ID, profile: { role: 'candidate', approval_status: 'approved' }, company: null });
  server.requests.length = 0;
});

function Settled({ children }: { children: ReactNode }) {
  return useSession().settled ? children : null;
}

/** The app's root as far as pushes need it: the stack, the pending page, and the bridge. */
function Root() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            <Settled>
              <Stack screenOptions={{ headerShown: false }} />
              <PendingPath />
              <PushBridge />
            </Settled>
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function Home() {
  return <PushPrompt audience="candidate" />;
}

function Applications() {
  return <Text>applications</Text>;
}

function Feed() {
  return <Text>feed</Text>;
}

function SignIn() {
  return <Text>sign-in</Text>;
}

const app = {
  _layout: Root,
  index: Home,
  'dashboard/applications/index': Applications,
  notifications: Feed,
  'sign-in/index': SignIn,
  'account/alerts': AlertsScreen,
};

const registered = () => server.asked('/rest/v1/rpc/register_push_device').map((request) => request.body);

describe('asking, with a reason', () => {
  it('asks the phone only when pressed, then registers this phone for the person signed in', async () => {
    renderRouter(app, { initialUrl: '/' });

    expect(await screen.findByText(ar.app.push.promptTitle)).toBeTruthy();
    expect(screen.getByText(ar.app.push.promptCandidate)).toBeTruthy();
    // Nothing asked of the phone, nothing registered, until somebody says yes.
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(registered()).toHaveLength(0);

    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(granted as never);
    fireEvent.press(screen.getByRole('button', { name: ar.app.push.turnOn }));

    await waitFor(() => expect(registered()[0]).toEqual({ p_token: TOKEN, p_platform: 'ios', p_locale: 'ar', p_app_version: '1.0.0' }));
    await waitFor(() => expect(screen.queryByText(ar.app.push.promptTitle) === null).toBe(true));
  });

  it('puts the prompt away for good on "not now"', async () => {
    const first = renderRouter(app, { initialUrl: '/' });
    fireEvent.press(await screen.findByRole('button', { name: ar.app.push.notNow }));
    await waitFor(() => expect(screen.queryByText(ar.app.push.promptTitle) === null).toBe(true));
    first.unmount();

    // Read again from scratch — the phone's answer and the choice kept here — and still away.
    const reads = jest.mocked(Notifications.getPermissionsAsync).mock.calls.length;
    renderRouter(app, { initialUrl: '/' });
    await waitFor(() => expect(jest.mocked(Notifications.getPermissionsAsync).mock.calls.length).toBeGreaterThan(reads));
    await act(async () => {});
    await act(async () => {});
    expect(screen.queryByText(ar.app.push.promptTitle)).toBeNull();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('registers nothing when the phone says no', async () => {
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue(denied as never);
    renderRouter(app, { initialUrl: '/' });
    const turnOn = await screen.findByRole('button', { name: ar.app.push.turnOn });

    // The system's question, answered no: from now on the phone says denied.
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(denied as never);
    fireEvent.press(turnOn);
    await waitFor(() => expect(screen.queryByText(ar.app.push.promptTitle) === null).toBe(true));
    expect(registered()).toHaveLength(0);
  });
});

describe('this phone, registered', () => {
  it('registers at launch for somebody who allowed it', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(granted as never);
    renderRouter(app, { initialUrl: '/' });
    await waitFor(() => expect(registered()).toHaveLength(1));
  });

  it('is turned off and on from the account, the database told each time', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(granted as never);
    renderRouter(app, { initialUrl: '/account/alerts' });
    await waitFor(() => expect(registered()).toHaveLength(1));

    const toggle = await screen.findByLabelText(ar.app.push.switch);
    expect(toggle.props.value).toBe(true);
    fireEvent(toggle, 'valueChange', false);
    await waitFor(() =>
      expect(server.asked('/rest/v1/rpc/unregister_push_device')[0]?.body).toEqual({ p_token: TOKEN }),
    );
    await waitFor(() => expect(screen.getByLabelText(ar.app.push.switch).props.value).toBe(false));

    fireEvent(screen.getByLabelText(ar.app.push.switch), 'valueChange', true);
    await waitFor(() => expect(registered()).toHaveLength(2));
    await waitFor(() => expect(screen.getByLabelText(ar.app.push.switch).props.value).toBe(true));
  });

  it("says when the phone's settings have them off, with the way there", async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(denied as never);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    renderRouter(app, { initialUrl: '/account/alerts' });

    expect(await screen.findByText(ar.app.push.denied)).toBeTruthy();
    expect(screen.getByLabelText(ar.app.push.switch).props.disabled).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: ar.app.push.openSettings }));
    expect(openSettings).toHaveBeenCalled();
    openSettings.mockRestore();
  });
});

describe('what to hear about', () => {
  const chosen = { push_job_alerts: true, push_applications: true, push_account: true, push_quiet_hours: false };
  const saves = () => server.asked('/api/mobile/v1/actions/updatePushPreferences').map((request) => request.body);

  it('offers a candidate each kind once pushes are on, and saves the one flipped', async () => {
    me = { ...profile, ...chosen };
    server.on('POST /api/mobile/v1/actions/updatePushPreferences', { ok: true });
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(granted as never);
    renderRouter(app, { initialUrl: '/account/alerts' });

    expect(await screen.findByText(ar.app.push.kindsTitle)).toBeTruthy();
    expect(screen.getByLabelText(ar.app.push.jobAlerts).props.value).toBe(true);
    expect(screen.getByLabelText(ar.app.push.applicationsCandidate).props.value).toBe(true);
    expect(screen.getByLabelText(ar.app.push.accountCandidate).props.value).toBe(true);
    expect(screen.getByLabelText(ar.app.push.quiet).props.value).toBe(false);

    fireEvent(screen.getByLabelText(ar.app.push.jobAlerts), 'valueChange', false);
    await waitFor(() => expect(saves()).toEqual([{ input: { push_job_alerts: false } }]));
    expect(await screen.findByText(ar.common.saveSuccess)).toBeTruthy();
    expect(screen.getByLabelText(ar.app.push.jobAlerts).props.value).toBe(false);

    fireEvent(screen.getByLabelText(ar.app.push.quiet), 'valueChange', true);
    await waitFor(() => expect(saves()[1]).toEqual({ input: { push_quiet_hours: true } }));
  });

  it('shows what another phone saved since, and never writes this phone\'s older copy back over it', async () => {
    me = { ...profile, ...chosen };
    server.on('POST /api/mobile/v1/actions/updatePushPreferences', () => {
      // Meanwhile, on another phone: the account's pushes turned off.
      me = { ...me, push_job_alerts: false, push_account: false };
      return { ok: true };
    });
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(granted as never);
    renderRouter(app, { initialUrl: '/account/alerts' });

    fireEvent(await screen.findByLabelText(ar.app.push.jobAlerts), 'valueChange', false);
    // Only the switch flipped here was sent: not push_account as this phone last read it.
    await waitFor(() => expect(saves()).toEqual([{ input: { push_job_alerts: false } }]));
    // And once the saved values are read again, the switch nobody flipped here follows them.
    await waitFor(() => expect(screen.getByLabelText(ar.app.push.accountCandidate).props.value).toBe(false));
    expect(screen.getByLabelText(ar.app.push.jobAlerts).props.value).toBe(false);
    expect(screen.getByLabelText(ar.app.push.applicationsCandidate).props.value).toBe(true);
  });

  it('follows another phone\'s later change to a switch flipped here once', async () => {
    me = { ...profile, ...chosen };
    // The website applies what it is sent, as updatePushPreferences does.
    server.on('POST /api/mobile/v1/actions/updatePushPreferences', (_url, init) => {
      const { input } = JSON.parse(String(init?.body));
      me = { ...me, ...input };
      return { ok: true };
    });
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(granted as never);
    renderRouter(app, { initialUrl: '/account/alerts' });

    // Quiet hours on, here; saved.
    fireEvent(await screen.findByLabelText(ar.app.push.quiet), 'valueChange', true);
    expect(await screen.findByText(ar.common.saveSuccess)).toBeTruthy();

    // Later, on another phone: quiet hours off again. This phone reads the
    // profile again, and the switch flipped here earlier shows what is saved.
    me = { ...me, push_quiet_hours: false, push_account: false };
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['viewer'] });
    });
    await waitFor(() => expect(screen.getByLabelText(ar.app.push.accountCandidate).props.value).toBe(false));
    expect(screen.getByLabelText(ar.app.push.quiet).props.value).toBe(false);
  });

  it('puts a refused switch back to what was read meanwhile, not to what it showed before', async () => {
    me = { ...profile, ...chosen };
    server.on('POST /api/mobile/v1/actions/updatePushPreferences', { ok: false, error: 'failed' });
    // The save's answer held back until the profile has been read again.
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    const plain = server.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (href.includes('updatePushPreferences')) await answered;
      return plain(input, init);
    }) as typeof fetch;
    try {
      jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(granted as never);
      renderRouter(app, { initialUrl: '/account/alerts' });

      // Applications off, here; the save on its way.
      fireEvent(await screen.findByLabelText(ar.app.push.applicationsCandidate), 'valueChange', false);
      // Meanwhile another phone turns them off too, and this phone reads the profile.
      me = { ...me, push_applications: false, push_account: false };
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ['viewer'] });
      });
      await waitFor(() => expect(screen.getByLabelText(ar.app.push.accountCandidate).props.value).toBe(false));

      // Then this phone's save is refused: the switch shows what is saved, off.
      answer();
      expect(await screen.findByText(ar.common.errorBody)).toBeTruthy();
      expect(screen.getByLabelText(ar.app.push.applicationsCandidate).props.value).toBe(false);
    } finally {
      globalThis.fetch = plain as unknown as typeof fetch;
    }
  });

  it('puts a switch back when the website refuses it', async () => {
    me = { ...profile, ...chosen };
    server.on('POST /api/mobile/v1/actions/updatePushPreferences', { ok: false, error: 'failed' });
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(granted as never);
    renderRouter(app, { initialUrl: '/account/alerts' });

    fireEvent(await screen.findByLabelText(ar.app.push.applicationsCandidate), 'valueChange', false);
    expect(await screen.findByText(ar.common.errorBody)).toBeTruthy();
    expect(screen.getByLabelText(ar.app.push.applicationsCandidate).props.value).toBe(true);
  });

  it('offers an employer applicants and listings, and no new jobs — they keep no saved searches', async () => {
    me = { ...profile, role: 'employer', ...chosen };
    // An employer's session also reads their company: none yet is an answer.
    server.on('POST /rest/v1/rpc/my_company_id', () => null);
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(granted as never);
    renderRouter(app, { initialUrl: '/account/alerts' });

    expect(await screen.findByLabelText(ar.app.push.applicationsEmployer)).toBeTruthy();
    expect(screen.getByLabelText(ar.app.push.accountEmployer)).toBeTruthy();
    expect(screen.queryByLabelText(ar.app.push.jobAlerts)).toBeNull();
  });

  it('offers nothing while the database does not have the switches yet', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(granted as never);
    renderRouter(app, { initialUrl: '/account/alerts' });

    await screen.findByLabelText(ar.app.push.switch);
    await waitFor(() => expect(registered()).toHaveLength(1));
    expect(screen.queryByText(ar.app.push.kindsTitle)).toBeNull();
  });

  it('offers nothing while pushes are off on this phone', async () => {
    me = { ...profile, ...chosen };
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(denied as never);
    renderRouter(app, { initialUrl: '/account/alerts' });

    expect(await screen.findByText(ar.app.push.denied)).toBeTruthy();
    expect(screen.queryByText(ar.app.push.kindsTitle)).toBeNull();
  });
});

describe('a tapped push', () => {
  const response = (notificationId: string) =>
    ({
      actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
      notification: { request: { content: { data: { notificationId } } } },
    }) as unknown as Notifications.NotificationResponse;

  it('that launched the app opens where the website says the notification leads', async () => {
    jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(response(NOTIFICATION));
    const result = renderRouter(app, { initialUrl: '/' });

    await waitFor(() => expect(result.getPathname()).toBe('/dashboard/applications'));
    expect((server.asked('/api/mobile/v1/actions/openNotification')[0]?.body as { input: unknown }).input).toEqual({
      id: NOTIFICATION,
    });
    // Opened once: the system's record of it is cleared.
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
  });

  it('while the app runs opens the same way, and the feed when the link has gone', async () => {
    const result = renderRouter(app, { initialUrl: '/' });
    await screen.findByText(ar.app.push.promptTitle);
    const listener = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock.calls.at(-1)?.[0];

    server.on('POST /api/mobile/v1/actions/openNotification', { ok: true, data: { fallback: '/notifications?link=gone' } });
    act(() => listener?.(response(NOTIFICATION)));
    await waitFor(() => expect(result.getPathname()).toBe('/notifications'));
    // With the reason, which the feed says as it does for a tap in the bell.
    expect(result.getSearchParams()).toEqual({ link: 'gone' });
  });

  it('asks somebody signed out to sign in, and comes back to the feed', async () => {
    await supabase.auth.signOut({ scope: 'local' });
    await rememberActor(null);
    jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(response(NOTIFICATION));
    const result = renderRouter(app, { initialUrl: '/' });

    await waitFor(() => expect(result.getPathname()).toBe('/sign-in'));
    expect(result.getSearchParams()).toEqual({ next: '/notifications' });
    expect(server.asked('/api/mobile/v1/actions/openNotification')).toHaveLength(0);
  });
});

describe('a push while the app is open', () => {
  it('reads again what it is most often about, as well as the bell and the account', async () => {
    renderRouter(app, { initialUrl: '/' });
    await screen.findByText(ar.app.push.promptTitle);
    const listener = jest.mocked(Notifications.addNotificationReceivedListener).mock.calls.at(-1)?.[0];
    const invalidated = jest.spyOn(queryClient, 'invalidateQueries');

    act(() => listener?.({} as Notifications.Notification));
    const keys = invalidated.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([
        '["notifications"]',
        '["viewer"]',
        // A new applicant: the company's inbox, pipelines, overview and counts.
        '["employer","applicants"]',
        '["employer","summary"]',
        '["employer","trend"]',
        '["employer","listings"]',
        // A move: the candidate's applications, and the summary on their Home.
        '["applications"]',
        '["candidate"]',
      ]),
    );
    invalidated.mockRestore();
  });
});

describe('signing out', () => {
  it('tells the database to forget this phone first, then stops listening on it', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(granted as never);
    renderRouter(app, { initialUrl: '/' });
    await waitFor(() => expect(registered()).toHaveLength(1));

    await act(async () => {
      await signOutHere();
    });
    const order = server.requests.map((request) => request.url.pathname);
    expect(order.indexOf('/rest/v1/rpc/unregister_push_device')).toBeGreaterThan(-1);
    expect(order.indexOf('/rest/v1/rpc/unregister_push_device')).toBeLessThan(order.indexOf('/auth/v1/logout'));
    await waitFor(() => expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled());
    expect(Notifications.setBadgeCountAsync).toHaveBeenLastCalledWith(0);
    // And what was delivered for them leaves Notification Center, for whoever has the phone next.
    expect(Notifications.dismissAllNotificationsAsync).toHaveBeenCalled();
  });

  it('stops listening on the phone when the session ends elsewhere', async () => {
    renderRouter(app, { initialUrl: '/' });
    await screen.findByText(ar.app.push.promptTitle);

    // A refresh the auth server refused: the session is gone before the phone could say anything.
    await act(async () => {
      await supabase.auth.signOut({ scope: 'local' });
    });
    await waitFor(() => expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled());
  });
});

describe('another account taking over the phone without a sign-out', () => {
  // An email link opened for another account: its session replaces this one.
  const OTHER = authUser({ id: 'c0000000-0000-4000-8000-0000000000b2', email: 'omar@example.com' });
  async function switchToOther() {
    server.on('POST /auth/v1/token', () => authSession(OTHER));
    await act(async () => {
      await supabase.auth.signInWithPassword({ email: OTHER.email, password: PASSWORD });
    });
  }

  it("stops this phone hearing the last person's news, while the new one has no profile yet", async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(granted as never);
    renderRouter(app, { initialUrl: '/' });
    await waitFor(() => expect(registered()).toHaveLength(1));

    // On their way to onboarding: nothing to register them for yet.
    server.on('/rest/v1/profiles', () => []);
    await switchToOther();
    await waitFor(() => expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled());
    expect(registered()).toHaveLength(1);
  });

  it('registers it for the new person once that stop is done, not before it', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(granted as never);
    renderRouter(app, { initialUrl: '/' });
    await waitFor(() => expect(registered()).toHaveLength(1));

    const order: string[] = [];
    jest.mocked(Notifications.unregisterForNotificationsAsync).mockImplementationOnce(async () => {
      order.push('stopped');
    });
    jest.mocked(Notifications.getExpoPushTokenAsync).mockImplementationOnce(async () => {
      order.push('token');
      return { type: 'expo', data: TOKEN };
    });
    me = { ...profile, id: OTHER.id, full_name: 'عمر حسن' };
    await switchToOther();
    await waitFor(() => expect(registered()).toHaveLength(2));
    expect(order).toEqual(['stopped', 'token']);
  });
});

describe('the badge', () => {
  it("is the bell's unread count", async () => {
    unread = 3;
    renderRouter(app, { initialUrl: '/' });
    await waitFor(() => expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(3));
  });
});

describe('Android', () => {
  it('offers pushes only to a build that has Firebase, where its token comes from', () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    const config = Constants.expoConfig as { android?: { googleServicesFile?: string } };
    const before = config.android;
    try {
      config.android = {};
      expect(pushAvailable()).toBe(false);
      config.android = { googleServicesFile: './google-services.json' };
      expect(pushAvailable()).toBe(true);
    } finally {
      config.android = before;
      os.restore();
    }
  });
});

describe('a build without a push project', () => {
  beforeEach(() => {
    delete mockEas.projectId;
  });
  afterEach(() => {
    mockEas.projectId = PROJECT;
  });

  it('asks nothing on Home', async () => {
    renderRouter(app, { initialUrl: '/' });
    await waitFor(() => expect(jest.mocked(Notifications.getPermissionsAsync)).toHaveBeenCalled());
    await act(async () => {});
    await act(async () => {});
    expect(screen.queryByText(ar.app.push.promptTitle)).toBeNull();
  });

  it('registers nothing, even with the phone allowing it, and leaves its registration alone at sign-out', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(granted as never);
    renderRouter(app, { initialUrl: '/' });
    await act(async () => {});
    await act(async () => {});
    expect(registered()).toHaveLength(0);

    await act(async () => {
      await signOutHere();
    });
    await waitFor(() => expect(Notifications.setBadgeCountAsync).toHaveBeenLastCalledWith(0));
    expect(Notifications.unregisterForNotificationsAsync).not.toHaveBeenCalled();
  });

  it('says so in the account, with no switch that would turn on nothing', async () => {
    renderRouter(app, { initialUrl: '/account/alerts' });
    expect(await screen.findByText(ar.app.push.unavailable)).toBeTruthy();
    expect(screen.queryByLabelText(ar.app.push.switch)).toBeNull();
  });
});
