import type { ReactNode } from 'react';
import { Linking, Text } from 'react-native';
import { Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { AdminUserActivity, AdminUserFacts, AdminUserSearchRow, ProfileRow } from '@/lib/supabase/database.types';
import { DecisionSheetHost } from '~/components/admin/decision-sheet';
import { toast } from '~/components/feedback/toast';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as AccountsScreen from '../src/app/(tabs)/(admin)/admin/users/index';
import * as AccountScreen from '../src/app/(tabs)/(admin)/admin/users/[id]';
import { authSession, authUser, mobileConfig, profile, totpFactor, USER_ID } from './auth-fixtures';
import { company } from './fixtures';
import { fakeServer } from './server';

/*
  The accounts half of the console in the app — the website's /admin/users
  and one account's file — as the real screens draw them against stand-ins
  for Supabase and the website: the list and its views (each one query to
  admin_search_users), the file's four tabs, and the account's own levers,
  each through the website's admin action with the reason typed, and none at
  all on the admin's own file.
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
const OTHER_USER = '8b7c7f1e-0000-4000-8000-000000000099';

const adminProfile: ProfileRow = { ...profile, role: 'admin', full_name: 'كيرلس إدوارد' };

const row: AdminUserSearchRow = {
  id: OTHER_USER,
  role: 'employer',
  full_name: 'أحمد سمير',
  avatar_url: null,
  approval_status: 'approved',
  approval_note: null,
  created_at: '2026-10-21T10:00:00Z',
  company_id: company.id,
  company_name_ar: company.name_ar,
  company_name_en: null,
  agent_slug: null,
  agent_restricted: false,
  total_count: 1,
  sign_in_blocked: false,
  last_sign_in_at: '2026-10-21T12:00:00Z',
};

/** The other account's profile, as the file reads it (the reviewer's note embedded from profile_private). */
const account = {
  id: OTHER_USER,
  role: 'employer',
  full_name: 'أحمد سمير',
  avatar_url: null,
  locale: 'ar',
  created_at: '2026-10-21T10:00:00Z',
  approval_status: 'approved',
  approved_at: '2026-10-21T11:00:00Z',
  private: { approval_note: null },
};

const facts: AdminUserFacts = {
  email_confirmed: true,
  last_sign_in_at: '2026-10-21T12:00:00Z',
  providers: ['email', 'google'],
  sign_in_blocked_until: null,
  verified_factors: 0,
  sessions: 2,
};

const activity: AdminUserActivity = {
  applications: { total: 4, by_status: { new: 1, hired: 3 } },
  listings: { total: 2, by_status: { active: 2 } },
  reports_filed: { total: 0, dismissed: 0, abusive: 0, open: 0 },
  appeals: { total: 1, open: 0 },
  saved_jobs: 5,
  notes: 0,
  decisions: 3,
};

let me: ProfileRow;
let other: typeof account;

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  me = { ...adminProfile };
  other = { ...account };
  server.on('GET /api/mobile/v1/config', mobileConfig({ adminMfaRequired: true }));
  server.on('POST /auth/v1/logout', {});
  // The viewer's own profile, or the account whose file is open.
  server.on('/rest/v1/profiles', (url: URL) => (url.searchParams.get('id') === `eq.${OTHER_USER}` ? [other] : [me]));
  server.on('POST /rest/v1/rpc/my_company_id', () => null);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  server.on('POST /rest/v1/rpc/admin_search_users', () => [row]);
  server.on('POST /rest/v1/rpc/admin_user_facts', () => facts);
  server.on('POST /rest/v1/rpc/admin_user_activity', () => activity);
  server.on('GET /rest/v1/company_members', []);
  server.on('GET /rest/v1/agent_profiles', []);
  server.on('GET /rest/v1/applications', []);
  server.on('GET /rest/v1/reporting_restrictions', []);
  server.on('GET /rest/v1/admin_audit_log', []);
  server.on('GET /rest/v1/moderation_notes', []);
  server.on('POST /api/mobile/v1/actions/setUserRole', { ok: true });
  server.on('POST /api/mobile/v1/actions/setSignInBlock', { ok: true, data: { sessionsEnded: 2 } });
  server.on('POST /api/mobile/v1/actions/revealContact', { ok: true, data: { email: 'ahmed@example.com', phone: '+201001234567' } });

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
              <DecisionSheetHost />
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
  '(tabs)/(admin)/admin/users/index': AccountsScreen,
  '(tabs)/(admin)/admin/users/[id]': AccountScreen,
  mfa: stand('the code screen'),
};

function actionsCalled(name: string) {
  return server.requests.filter((request) => request.method === 'POST' && request.url.pathname === `/api/mobile/v1/actions/${name}`);
}

/** What the list last asked admin_search_users for. */
function lastSearch() {
  return server.asked('/rest/v1/rpc/admin_search_users').at(-1)?.body as Record<string, unknown> | undefined;
}

/** The sheet's own confirm button: the last one with the lever's label, after the one on the screen that opened it. */
function confirmButton(label: string) {
  return screen.getAllByRole('button', { name: label }).at(-1)!;
}

describe('the accounts', () => {
  it('draws the rows admin_search_users answers, searches the words typed, and asks for each view the way the website does', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/users' });

    expect(await screen.findByText('أحمد سمير')).toBeTruthy();
    expect(screen.getByText(ar.admin.approval.approved)).toBeTruthy();
    // The waiting accounts first, as the website's queue; no words, no search.
    expect(lastSearch()).toMatchObject({ p_query: null, p_role: null, p_status: 'pending', p_blocked: null, p_offset: 0 });

    const field = screen.getByLabelText(ar.filters.search);
    expect(field.props.placeholder).toBe(ar.admin.usersSearchPlaceholder);
    fireEvent.changeText(field, '  أحمد  ');
    fireEvent(field, 'submitEditing');
    await waitFor(() => expect(lastSearch()?.p_query).toBe('أحمد'));

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.signInBlocked }));
    await waitFor(() => expect(lastSearch()).toMatchObject({ p_blocked: true, p_status: null, p_role: null }));

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.approval.rejected }));
    await waitFor(() => expect(lastSearch()).toMatchObject({ p_status: 'rejected', p_blocked: null }));
  });

  it('says a search found nobody, and that a failed read failed — never that nothing is waiting', async () => {
    await signIn();
    server.on('POST /rest/v1/rpc/admin_search_users', (url: URL, init: RequestInit | undefined) =>
      JSON.parse(String(init?.body)).p_query ? [] : { status: 503, body: { code: 'PGRST002', message: 'schema cache' } },
    );
    renderRouter(app, { initialUrl: '/admin/users' });

    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.admin.emptyQueue)).toBeNull();

    const field = screen.getByLabelText(ar.filters.search);
    fireEvent.changeText(field, 'منى');
    fireEvent(field, 'submitEditing');
    expect(await screen.findByText(ar.admin.searchNothing)).toBeTruthy();
  });
});

describe("an account's file", () => {
  it('shows who they are, how they sign in, and what they have done', async () => {
    await signIn();
    renderRouter(app, { initialUrl: `/admin/users/${OTHER_USER}` });

    expect(await screen.findByText('أحمد سمير')).toBeTruthy();
    expect(screen.getByText(ar.onboarding.roleEmployer)).toBeTruthy();
    expect(screen.getByText(OTHER_USER)).toBeTruthy();

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.userTabs.security }));
    expect(await screen.findByText(ar.admin.signedInDevices)).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('email، google')).toBeTruthy();
    expect(screen.getByText(ar.admin.signInAllowed)).toBeTruthy();
    // Email confirmed: yes; two-step sign-in: no.
    expect(screen.getByText(ar.admin.yes)).toBeTruthy();
    expect(screen.getByText(ar.admin.no)).toBeTruthy();

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.userTabs.activity }));
    expect(await screen.findByText(ar.admin.applicationsCount.replace('{count}', '4'))).toBeTruthy();
    expect(screen.getByText(`${ar.applicationStatus.hired}: 3`)).toBeTruthy();
    expect(screen.getByText(ar.admin.listingsCount.replace('{count}', '2'))).toBeTruthy();
    expect(screen.getByText(ar.admin.decisionsCount.replace('{count}', '3'))).toBeTruthy();
    expect(screen.getByText(ar.admin.savedJobsCount.replace('{count}', '5'))).toBeTruthy();
  });

  it('makes an admin through the website, only once a reason is typed', async () => {
    await signIn();
    renderRouter(app, { initialUrl: `/admin/users/${OTHER_USER}` });

    fireEvent.press(await screen.findByRole('button', { name: ar.admin.makeAdmin }));
    expect(await screen.findByText(ar.admin.makeAdminBody)).toBeTruthy();
    const field = screen.getByLabelText(ar.admin.reasonOnRecord);
    expect(confirmButton(ar.admin.makeAdmin).props.accessibilityState?.disabled).toBe(true);

    fireEvent.changeText(field, 'بيساعد في المراجعة');
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.makeAdmin));
    });
    await waitFor(() => expect(actionsCalled('setUserRole')).toHaveLength(1));
    expect(actionsCalled('setUserRole')[0].body).toEqual({ input: { userId: OTHER_USER, role: 'admin', reason: 'بيساعد في المراجعة' } });
  });

  it('blocks sign-in from the security tab, with the reason', async () => {
    await signIn();
    renderRouter(app, { initialUrl: `/admin/users/${OTHER_USER}` });

    fireEvent.press(await screen.findByRole('radio', { name: ar.admin.userTabs.security }));
    fireEvent.press(await screen.findByRole('button', { name: ar.admin.blockSignIn }));
    fireEvent.changeText(await screen.findByLabelText(ar.admin.reasonOnRecord), 'حساب مخترق');
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.blockSignIn));
    });
    await waitFor(() => expect(actionsCalled('setSignInBlock')).toHaveLength(1));
    expect(actionsCalled('setSignInBlock')[0].body).toEqual({ input: { userId: OTHER_USER, block: true, reason: 'حساب مخترق' } });
  });

  it('reveals the contact for a reason, and shows the number only once the website answered', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await signIn();
    renderRouter(app, { initialUrl: `/admin/users/${OTHER_USER}` });

    fireEvent.press(await screen.findByRole('button', { name: ar.admin.revealContact }));
    fireEvent.changeText(await screen.findByLabelText(ar.admin.reasonOnRecord), 'طلب دعم من صاحب الحساب');
    expect(screen.queryByText('+201001234567')).toBeNull();
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.revealContact));
    });

    await waitFor(() => expect(actionsCalled('revealContact')).toHaveLength(1));
    expect(actionsCalled('revealContact')[0].body).toEqual({ input: { userId: OTHER_USER, reason: 'طلب دعم من صاحب الحساب' } });
    expect(await screen.findByText('+201001234567')).toBeTruthy();
    expect(screen.getByText('ahmed@example.com')).toBeTruthy();
    expect(screen.getByText(ar.admin.contactRecorded)).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: ar.app.admin.call }));
    expect(openURL).toHaveBeenCalledWith('tel:+201001234567');
    fireEvent.press(screen.getByRole('button', { name: ar.app.admin.openWhatsApp }));
    expect(openURL).toHaveBeenCalledWith('https://wa.me/201001234567');
    openURL.mockRestore();
  });

  it("offers no lever on the admin's own file", async () => {
    await signIn();
    renderRouter(app, { initialUrl: `/admin/users/${USER_ID}` });

    expect(await screen.findByText(ar.admin.contactSelf)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.admin.makeAdmin })).toBeNull();
    expect(screen.queryByRole('button', { name: ar.admin.removeAdmin })).toBeNull();
    expect(screen.queryByRole('button', { name: ar.admin.suspendAccount })).toBeNull();
    expect(screen.queryByRole('button', { name: ar.admin.revealContact })).toBeNull();

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.userTabs.security }));
    expect(await screen.findByText(ar.admin.signedInDevices)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.admin.endSessions })).toBeNull();
    expect(screen.queryByRole('button', { name: ar.admin.blockSignIn })).toBeNull();
  });

  it("offers another admin's file only the two levers the product has for an admin", async () => {
    other = { ...account, role: 'admin' };
    await signIn();
    renderRouter(app, { initialUrl: `/admin/users/${OTHER_USER}` });

    expect(await screen.findByRole('button', { name: ar.admin.removeAdmin })).toBeTruthy();
    expect(screen.getByText(ar.admin.adminNoLever)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.admin.suspendAccount })).toBeNull();
    expect(screen.queryByRole('button', { name: ar.admin.restrictAccount })).toBeNull();
    expect(screen.queryByRole('button', { name: ar.admin.makeAdmin })).toBeNull();

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.userTabs.security }));
    expect(await screen.findByRole('button', { name: ar.admin.endSessions })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.admin.blockSignIn })).toBeNull();
  });
});
