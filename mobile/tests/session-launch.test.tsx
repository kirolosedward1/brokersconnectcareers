import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { SESSION_KEY, supabase } from '~/lib/supabase';
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

  // No clean-up timers left running once the test is done (gcTime).
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
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

it("takes the last person's data off the screen when a reset link signs another account in", async () => {
  jest.useFakeTimers();
  store.clear();
  store.set(SESSION_KEY, JSON.stringify(authSession(authUser())));
  await AsyncStorage.clear();
  const other = authUser({ id: 'c0000000-0000-4000-8000-0000000000b2', email: 'omar@example.com' });
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return url.pathname === '/auth/v1/verify' ? json(authSession(other)) : json([]);
  }) as unknown as typeof fetch;

  // No clean-up timers left running once the test is done (gcTime).
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(['saved', 'jobs'], ['a listing the last person saved']);
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </QueryClientProvider>,
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(50);
  });

  // The link was for another account: its session replaces this one, with an event of its own.
  await act(async () => {
    await supabase.auth.verifyOtp({ type: 'recovery', token_hash: 'pkce_0123456789abcdef' });
  });
  expect(client.getQueryData(['saved', 'jobs'])).toBeUndefined();
  jest.useRealTimers();
});
