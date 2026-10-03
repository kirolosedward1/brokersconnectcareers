import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { SESSION_KEY } from '~/lib/supabase';
import { tabsFor } from '~/lib/tabs';
import { authSession, authUser, USER_ID } from './auth-fixtures';

/*
  The app opened with no network, an hour after it was last used: the session
  on the phone has an access token that has expired and cannot be refreshed
  yet. Who the app says is signed in, and when.
*/

jest.mock('~/lib/session-storage', () => ({
  encryptedSessionStorage: {
    getItem: async (key: string) => (globalThis as unknown as { __store: Map<string, string> }).__store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      (globalThis as unknown as { __store: Map<string, string> }).__store.set(key, value);
    },
    removeItem: async (key: string) => {
      (globalThis as unknown as { __store: Map<string, string> }).__store.delete(key);
    },
  },
}));

const store = new Map<string, string>();
(globalThis as unknown as { __store: Map<string, string> }).__store = store;

function Probe() {
  const { ready, session, actor } = useSession();
  return <Text>{`ready=${ready} session=${session ? 'yes' : 'no'} tabs=${tabsFor(actor).join(',')}`}</Text>;
}

it('is signed in at once from what the phone stored, and stays signed in while the token cannot be refreshed', async () => {
  jest.useFakeTimers();
  store.set(SESSION_KEY, JSON.stringify({ ...authSession(authUser()), expires_at: Math.floor(Date.now() / 1000) - 3600 }));
  await AsyncStorage.clear();
  await rememberActor({ userId: USER_ID, profile: { role: 'candidate', approval_status: 'approved' }, company: null });
  globalThis.fetch = jest.fn(async () => {
    throw new TypeError('Network request failed');
  }) as unknown as typeof fetch;

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </QueryClientProvider>,
  );

  // Straight from storage — not after supabase-js has spent half a minute trying to refresh.
  await act(async () => {
    await jest.advanceTimersByTimeAsync(50);
  });
  expect(screen.getByText(/ready=true session=yes tabs=home,jobs,applications,saved,account/)).toBeTruthy();

  // supabase-js gives up on the refresh: still the same person, not a stranger with the public tabs.
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_000);
  });
  expect(screen.getByText(/ready=true session=yes tabs=home,jobs,applications,saved,account/)).toBeTruthy();
  expect(store.has(SESSION_KEY)).toBe(true);
  jest.useRealTimers();
});
