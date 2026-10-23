import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { AdminSearchRow, ProfileRow } from '@/lib/supabase/database.types';
import { toast } from '~/components/feedback/toast';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as SearchScreen from '../src/app/(tabs)/(admin)/admin/search/index';
import { authSession, authUser, mobileConfig, profile, totpFactor, USER_ID } from './auth-fixtures';
import { fakeServer } from './server';

/*
  The console's search in the app — the website's /admin/search — as the
  real screen draws it against a stand-in for Supabase: nothing asked until
  there are two characters to ask with, the words sent trimmed and cut where
  the website cuts them, the results by kind and six of each at most, each
  opening its own screen, and a search that failed said as that — never as
  "nothing found".
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
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));

const ar = catalogues.ar;
const server = fakeServer();
const PASSWORD = 'correct-horse';
const JOB_ID = '5b0c7d1e-0000-4000-8000-000000000301';
const OTHER_USER = '8b7c7f1e-0000-4000-8000-000000000099';
const AGENT_ID = '9d2e9f3a-0000-4000-8000-000000000503';

const adminProfile: ProfileRow = { ...profile, role: 'admin', full_name: 'كيرلس إدوارد' };

const found: AdminSearchRow[] = [
  { kind: 'user', id: OTHER_USER, label: 'أحمد سمير', sublabel: 'employer', state: 'approved' },
  { kind: 'job', id: JOB_ID, label: 'مستشار مبيعات', sublabel: 'شركة النيل', state: 'active' },
  { kind: 'agent', id: AGENT_ID, label: 'منى علي', sublabel: 'mona-ali', state: 'restricted' },
];

let me: ProfileRow;

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  me = { ...adminProfile };
  server.on('GET /api/mobile/v1/config', mobileConfig({ adminMfaRequired: true }));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', () => [me]);
  server.on('POST /rest/v1/rpc/my_company_id', () => null);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  server.on('POST /rest/v1/rpc/admin_search', () => found);

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  toast.hide();
});

/** An admin, signed in with their authenticator's code (aal2). */
async function signIn() {
  const user = authUser({ factors: [totpFactor] });
  server.on('POST /auth/v1/token', () => authSession(user, 'aal2'));
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
  await rememberActor({ userId: USER_ID, profile: { role: me.role, approval_status: me.approval_status }, company: null });
  server.requests.length = 0;
}

function Settled({ children }: { children: ReactNode }) {
  return useSession().settled ? children : null;
}

function Root() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            <Settled>
              <Stack screenOptions={{ headerShown: false }} />
            </Settled>
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function stand(label: string) {
  function Screen() {
    return <Text>{label}</Text>;
  }
  return Screen;
}

const app = {
  _layout: Root,
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/(home)/index': stand('home'),
  '(tabs)/(admin)/admin/index': stand('the overview'),
  '(tabs)/(admin)/admin/search/index': SearchScreen,
  '(tabs)/(admin)/admin/jobs/[id]': stand('the listing'),
  '(tabs)/(admin)/admin/users/[id]': stand('the account'),
  '(tabs)/(admin)/admin/agents/[id]': stand('the consultant'),
  mfa: stand('the code screen'),
};

function searches() {
  return server.asked('/rest/v1/rpc/admin_search');
}

function search(words: string) {
  const field = screen.getByLabelText(ar.admin.search);
  fireEvent.changeText(field, words);
  fireEvent(field, 'submitEditing');
}

describe('the console search', () => {
  it('asks nothing until there are two characters, then sends the words trimmed', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/search' });

    expect(await screen.findByText(ar.admin.searchLede)).toBeTruthy();
    expect(screen.getByLabelText(ar.admin.search).props.placeholder).toBe(ar.admin.searchEverythingPlaceholder);
    expect(searches()).toHaveLength(0);

    search(' أ ');
    expect(await screen.findByText(ar.admin.searchTooShort)).toBeTruthy();
    expect(searches()).toHaveLength(0);

    search('  أحمد  ');
    await waitFor(() => expect(searches()).toHaveLength(1));
    expect(searches()[0].body).toEqual({ p_query: 'أحمد' });
  });

  it('cuts the words where the website cuts them', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/search' });
    await screen.findByText(ar.admin.searchLede);

    search('م'.repeat(130));
    await waitFor(() => expect(searches()).toHaveLength(1));
    expect((searches()[0].body as { p_query: string }).p_query).toHaveLength(120);
  });

  it('groups what it finds by kind, in the website\'s words, and opens each thing on its own screen', async () => {
    await signIn();
    const result = renderRouter(app, { initialUrl: '/admin/search?q=سمير' });

    expect(await screen.findByText('أحمد سمير')).toBeTruthy();
    expect(searches()[0].body).toEqual({ p_query: 'سمير' });
    expect(screen.getByText(ar.admin.kind.user)).toBeTruthy();
    expect(screen.getByText(ar.admin.kind.job)).toBeTruthy();
    expect(screen.getByText(ar.admin.kind.agent)).toBeTruthy();
    expect(screen.queryByText(ar.admin.kind.company)).toBeNull();
    // Each state in the website's words: an account's standing, a listing's status, a restricted profile.
    expect(screen.getByText(ar.admin.approval.approved)).toBeTruthy();
    expect(screen.getByText(ar.jobStatus.active)).toBeTruthy();
    expect(screen.getByText(ar.admin.restricted)).toBeTruthy();
    expect(screen.getByText('شركة النيل')).toBeTruthy();

    fireEvent.press(screen.getByRole('link', { name: 'مستشار مبيعات' }));
    await waitFor(() => expect(result.getPathname()).toBe(`/admin/jobs/${JOB_ID}`));
    expect(await screen.findByText('the listing')).toBeTruthy();
  });

  it('draws six of a kind at most', async () => {
    server.on('POST /rest/v1/rpc/admin_search', () =>
      Array.from({ length: 8 }, (_, i): AdminSearchRow => ({ kind: 'user', id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, label: `حساب ${i}`, sublabel: null, state: null })),
    );
    await signIn();
    renderRouter(app, { initialUrl: '/admin/search?q=حساب' });

    expect(await screen.findByText('حساب 5')).toBeTruthy();
    expect(screen.queryByText('حساب 6')).toBeNull();
  });

  it('says nothing was found, and that a failed search failed — never that nothing was found', async () => {
    server.on('POST /rest/v1/rpc/admin_search', (url: URL, init: RequestInit | undefined) =>
      JSON.parse(String(init?.body)).p_query === 'منى' ? [] : { status: 503, body: { code: 'PGRST002', message: 'schema cache' } },
    );
    await signIn();
    renderRouter(app, { initialUrl: '/admin/search?q=أحمد' });

    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.admin.searchNothing)).toBeNull();

    search('منى');
    expect(await screen.findByText(ar.admin.searchNothing)).toBeTruthy();
  });
});
