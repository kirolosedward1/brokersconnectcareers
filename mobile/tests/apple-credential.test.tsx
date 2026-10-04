import type { ReactElement } from 'react';
import { Alert, AppState, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppleCredentialWatch } from '~/components/navigation/apple-credential-watch';
import { rememberAppleSignIn } from '~/features/auth/apple-credential';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import { authSession, authUser, mobileConfig, profile, USER_ID } from './auth-fixtures';
import { fakeServer } from './server';

/*
  Sign in with Apple turned off for this app in iOS's Settings (Apple ID →
  Sign in with Apple), or revoked by Apple: the person no longer lets this
  app use their Apple ID, and a session made with it should not outlive that.
  iOS answers for the Apple ID that signed in here, at launch and each time
  the app comes back.
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

const ar = catalogues.ar;
const server = fakeServer();
const user = authUser();
const APPLE_ID = '001234.0a1b2c3d4e5f.0123';
const state = AppleAuthentication.AppleAuthenticationCredentialState;
const credentialState = jest.mocked(AppleAuthentication.getCredentialStateAsync);

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
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: 'correct-horse' });
  expect(error).toBeNull();
  credentialState.mockReset();
  credentialState.mockResolvedValue(state.AUTHORIZED);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => jest.mocked(Alert.alert).mockRestore());

function Probe() {
  const { ready, session } = useSession();
  return <Text>{!ready ? 'loading' : session ? 'signed in' : 'signed out'}</Text>;
}

function app(): ReactElement {
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            <Probe />
            <AppleCredentialWatch />
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/** The app coming back to the front, as iOS tells React Native. */
function comeBack() {
  const listeners = jest
    .mocked(AppState.addEventListener)
    .mock.calls.filter(([type]) => type === 'change')
    .map(([, listener]) => listener as (next: string) => void);
  act(() => listeners.forEach((listener) => listener('active')));
}

describe('a session made with Sign in with Apple', () => {
  it('ends on this phone, saying why, once Apple no longer lets the app use that Apple ID', async () => {
    await rememberAppleSignIn(USER_ID, APPLE_ID);
    credentialState.mockResolvedValue(state.REVOKED);
    render(app());

    await waitFor(() => expect(credentialState).toHaveBeenCalledWith(APPLE_ID));
    expect(await screen.findByText('signed out')).toBeTruthy();
    expect(Alert.alert).toHaveBeenCalledWith(ar.app.auth.appleRevokedTitle, ar.app.auth.appleRevokedBody);
    const { data } = await supabase.auth.getSession();
    expect(data.session).toBeNull();
  });

  it('is asked about again each time the app comes back', async () => {
    await rememberAppleSignIn(USER_ID, APPLE_ID);
    render(app());
    await waitFor(() => expect(credentialState).toHaveBeenCalledTimes(1));
    expect(screen.getByText('signed in')).toBeTruthy();

    credentialState.mockResolvedValue(state.REVOKED);
    comeBack();
    expect(await screen.findByText('signed out')).toBeTruthy();
  });

  it.each([
    ['still authorized', state.AUTHORIZED],
    ['an Apple ID iOS does not know (signed out of iCloud, another Apple ID)', state.NOT_FOUND],
  ])('stays when the answer is %s', async (_, answer) => {
    await rememberAppleSignIn(USER_ID, APPLE_ID);
    credentialState.mockResolvedValue(answer);
    render(app());
    await waitFor(() => expect(credentialState).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByText('signed in')).toBeTruthy();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('stays when iOS cannot be asked', async () => {
    await rememberAppleSignIn(USER_ID, APPLE_ID);
    credentialState.mockRejectedValue(new Error('The operation couldn’t be completed.'));
    render(app());
    await waitFor(() => expect(credentialState).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByText('signed in')).toBeTruthy();
  });
});

describe('a session made another way', () => {
  it('never asks Apple anything', async () => {
    render(app());
    expect(await screen.findByText('signed in')).toBeTruthy();
    comeBack();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(credentialState).not.toHaveBeenCalled();
  });

  it("nor about the Apple ID somebody else signed in with on this phone before", async () => {
    await rememberAppleSignIn('someone-else', APPLE_ID);
    credentialState.mockResolvedValue(state.REVOKED);
    render(app());
    expect(await screen.findByText('signed in')).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(credentialState).not.toHaveBeenCalled();
  });
});
