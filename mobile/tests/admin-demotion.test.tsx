import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ProfileRow } from '@/lib/supabase/database.types';
import { I18nProvider } from '~/i18n/provider';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import { authSession, authUser, mobileConfig, profile, type AuthUser } from './auth-fixtures';
import { fakeServer } from './server';

/*
  An admin demoted on the same session (from the website, or another phone)
  keeps nothing of the console in memory once the app reads the account
  again. Sign-out and a switch of account already empty the cache; this is
  the case that did not.
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
const PASSWORD = 'correct-horse';
let user: AuthUser;
let me: ProfileRow;
let client: QueryClient;

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  user = authUser();
  me = { ...profile, role: 'admin' };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user, 'aal1'));
  server.on('POST /auth/v1/logout', {});
  server.on('GET /auth/v1/user', () => user);
  server.on('/rest/v1/profiles', () => [me]);
  server.on('POST /rest/v1/rpc/my_company_id', () => null);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
});

/** Shows the role the session has read, and reads the account again on a press. */
function Probe() {
  const { viewer } = useSession();
  const queryClient = useQueryClient();
  return (
    <>
      <Text>{`role:${viewer?.profile?.role ?? '…'}`}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="read the account again"
        onPress={() => void queryClient.invalidateQueries({ queryKey: ['viewer'] })}
      />
    </>
  );
}

function Root({ children }: { children?: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            <Stack screenOptions={{ headerShown: false }} />
            <Probe />
            {children}
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const app = { _layout: Root, index: () => null };

it("drops the console's data from memory when the account stops being an admin", async () => {
  await renderRouter(app, { initialUrl: '/' });
  expect(await screen.findByText('role:admin')).toBeTruthy();

  // What the console had read while the account was an admin.
  client.setQueryData(['admin', 'summary'], { pending: 3 });
  client.setQueryData(['admin', 'company', 'c1'], { company: { name_ar: 'شركة' } });
  client.setQueryData(['admin-door', user.id, 'token'], { state: 'open' });
  client.setQueryData(['taxonomy', 'districts'], [{ id: 1 }]);

  // Demoted elsewhere; the next read of the account says so.
  me = { ...me, role: 'employer' };
  fireEvent.press(screen.getByLabelText('read the account again'));
  expect(await screen.findByText('role:employer')).toBeTruthy();

  await waitFor(() => expect(client.getQueryData(['admin', 'summary'])).toBeUndefined());
  expect(client.getQueryData(['admin', 'company', 'c1'])).toBeUndefined();
  expect(client.getQueryData(['admin-door', user.id, 'token'])).toBeUndefined();
  // Public reads stay: nothing about them was the admin's.
  expect(client.getQueryData(['taxonomy', 'districts'])).toEqual([{ id: 1 }]);
});

it('keeps them while the account is still an admin', async () => {
  await renderRouter(app, { initialUrl: '/' });
  expect(await screen.findByText('role:admin')).toBeTruthy();
  client.setQueryData(['admin', 'summary'], { pending: 3 });

  fireEvent.press(screen.getByLabelText('read the account again'));
  await waitFor(() => expect(server.asked('/rest/v1/profiles').length).toBeGreaterThan(1));
  expect(client.getQueryData(['admin', 'summary'])).toEqual({ pending: 3 });
});
