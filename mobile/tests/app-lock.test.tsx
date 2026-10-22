import type { ReactElement } from 'react';
import { AppState, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppLockSettings } from '~/components/account/app-lock-settings';
import { AppLock } from '~/components/navigation/app-lock';
import { LOCK_AFTER_MS, lockOnReturn, resetAppLockForTests, setAppLock } from '~/features/app-lock/lock';
import { I18nProvider } from '~/i18n/provider';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import { authSession, authUser, mobileConfig, profile, USER_ID } from './auth-fixtures';
import { fakeServer } from './server';

/*
  The app lock and the switcher's cover. Somebody signed in leaves the app:
  what iOS pictures for its app switcher is the logo, not their screen. Who
  turned the lock on is asked the phone's own check at launch and after a
  minute away; nobody else is, and a signed-out reader is never covered.
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

const server = fakeServer();
const user = authUser();
const authenticate = jest.mocked(LocalAuthentication.authenticateAsync);
const enrolled = jest.mocked(LocalAuthentication.getEnrolledLevelAsync);

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

let client: QueryClient;
beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', [profile]);
  server.on('POST /rest/v1/rpc/unregister_push_device', () => null);
  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  resetAppLockForTests();
  authenticate.mockReset();
  authenticate.mockResolvedValue({ success: true });
  enrolled.mockResolvedValue(LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG);
});

async function signIn() {
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: 'correct-horse' });
  expect(error).toBeNull();
}

function Probe() {
  const { ready, session } = useSession();
  return <Text>{!ready ? 'loading' : session ? 'signed in' : 'signed out'}</Text>;
}

function app(children: ReactElement = <AppLock />): ReactElement {
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            <Probe />
            {children}
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/** iOS telling React Native where the app is now. */
function appGoes(next: 'active' | 'inactive' | 'background') {
  const listeners = jest
    .mocked(AppState.addEventListener)
    .mock.calls.filter(([type]) => type === 'change')
    .map(([, listener]) => listener as (state: string) => void);
  act(() => listeners.forEach((listener) => listener(next)));
}

describe('when the app is locked again', () => {
  it('after a minute in the background, not sooner, and never without having left', () => {
    expect(lockOnReturn(null, 10 * LOCK_AFTER_MS)).toBe(false);
    expect(lockOnReturn(1_000, 1_000 + LOCK_AFTER_MS - 1)).toBe(false);
    expect(lockOnReturn(1_000, 1_000 + LOCK_AFTER_MS)).toBe(true);
  });
});

describe('the cover', () => {
  it('hides a signed-in person’s screen while the app is not in front', async () => {
    await signIn();
    render(app());
    expect(await screen.findByText('signed in')).toBeTruthy();
    expect(screen.queryByTestId('privacy-cover')).toBeNull();

    appGoes('inactive');
    expect(screen.getByTestId('privacy-cover')).toBeTruthy();
    appGoes('background');
    expect(screen.getByTestId('privacy-cover')).toBeTruthy();
    appGoes('active');
    expect(screen.queryByTestId('privacy-cover')).toBeNull();
    // Nobody turned the lock on: nothing is asked.
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('is not drawn for a signed-out reader, whose board is public', async () => {
    render(app());
    expect(await screen.findByText('signed out')).toBeTruthy();
    appGoes('inactive');
    expect(screen.queryByTestId('privacy-cover')).toBeNull();
  });
});

describe('the lock', () => {
  it('asks at launch for the person who turned it on, and opens on the phone’s yes', async () => {
    await signIn();
    await setAppLock(USER_ID, true);
    let answer: (result: { success: true }) => void = () => {};
    authenticate.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    render(app());
    expect(await screen.findByTestId('app-lock')).toBeTruthy();
    await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('app-lock')).toBeTruthy();
    await act(async () => answer({ success: true }));
    await waitFor(() => expect(screen.queryByTestId('app-lock')).toBeNull());
  });

  it('stays shut when the check is cancelled, until the person asks again', async () => {
    await signIn();
    await setAppLock(USER_ID, true);
    authenticate.mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    render(app());
    await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('app-lock')).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByText(/^(افتح|Unlock)$/)));
    await waitFor(() => expect(screen.queryByTestId('app-lock')).toBeNull());
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it('locks again after a minute in the background, and not after a glance away', async () => {
    await signIn();
    await setAppLock(USER_ID, true);
    const clock = jest.spyOn(Date, 'now');
    clock.mockReturnValue(1_000_000);
    render(app());
    await waitFor(() => expect(screen.queryByTestId('app-lock')).toBeNull());

    appGoes('background');
    clock.mockReturnValue(1_000_000 + 5_000);
    appGoes('active');
    expect(screen.queryByTestId('app-lock')).toBeNull();

    let answer: (result: { success: true }) => void = () => {};
    authenticate.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    appGoes('background');
    clock.mockReturnValue(1_000_000 + 5_000 + LOCK_AFTER_MS);
    appGoes('active');
    expect(screen.getByTestId('app-lock')).toBeTruthy();
    await act(async () => answer({ success: true }));
    await waitFor(() => expect(screen.queryByTestId('app-lock')).toBeNull());
    expect(authenticate).toHaveBeenCalledTimes(2);
    clock.mockRestore();
  });

  it('does not lock somebody else signed in on the same phone', async () => {
    await signIn();
    await setAppLock('someone-else', true);
    render(app());
    expect(await screen.findByText('signed in')).toBeTruthy();
    expect(screen.queryByTestId('app-lock')).toBeNull();
  });

  it('lets its owner in, and turns itself off, once the phone can no longer ask', async () => {
    await signIn();
    await setAppLock(USER_ID, true);
    authenticate.mockResolvedValueOnce({ success: false, error: 'passcode_not_set' });
    render(app());
    await waitFor(() => expect(screen.queryByTestId('app-lock')).toBeNull());
    expect(JSON.parse((await AsyncStorage.getItem('bc.app-lock.v1')) ?? '[]')).toEqual([]);
  });
});

describe('the switch in Sign-in and security', () => {
  it('turns the lock on only after the phone’s own check', async () => {
    await signIn();
    render(app(<AppLockSettings />));
    const toggle = await screen.findByTestId('app-lock-switch');

    authenticate.mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    await act(async () => fireEvent(toggle, 'valueChange', true));
    expect(screen.getByTestId('app-lock-switch').props.value).toBe(false);

    await act(async () => fireEvent(screen.getByTestId('app-lock-switch'), 'valueChange', true));
    await waitFor(() => expect(screen.getByTestId('app-lock-switch').props.value).toBe(true));
    expect(JSON.parse((await AsyncStorage.getItem('bc.app-lock.v1')) ?? '[]')).toEqual([USER_ID]);
  });

  it('is not offered on a phone with no passcode', async () => {
    enrolled.mockResolvedValue(LocalAuthentication.SecurityLevel.NONE);
    await signIn();
    render(app(<AppLockSettings />));
    expect(await screen.findByText('signed in')).toBeTruthy();
    await act(async () => {});
    expect(screen.queryByTestId('app-lock-switch')).toBeNull();
  });
});
