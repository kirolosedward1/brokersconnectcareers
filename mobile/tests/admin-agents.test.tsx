import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlashList } from '@shopify/flash-list';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ProfileRow } from '@/lib/supabase/database.types';
import { DecisionSheetHost } from '~/components/admin/decision-sheet';
import { shownToast, toast } from '~/components/feedback/toast';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as AgentsScreen from '../src/app/(tabs)/(admin)/admin/agents/index';
import * as AgentScreen from '../src/app/(tabs)/(admin)/admin/agents/[id]';
import { DeclaredTabs } from './declared-tabs';
import { authSession, authUser, mobileConfig, profile, totpFactor, USER_ID } from './auth-fixtures';
import { newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  The consultant profiles in the console — the website's /admin/agents and
  one profile's page — as the real screens draw them against stand-ins for
  Supabase and the website: the list and its views (each one query over
  agent_profiles, searched by slug or by the owner's name as the website
  decides between them), the page's facts, and its one lever, restricting or
  lifting, through the website's admin action with the reason typed — and
  never a phone, an email or the CV's path in any request.
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
const OWNER = '8b7c7f1e-0000-4000-8000-000000000099';
const AGENT_ID = 'a9e47c1e-0000-4000-8000-000000000501';
const REPORTER = '8b7c7f1e-0000-4000-8000-000000000077';

const adminProfile: ProfileRow = { ...profile, role: 'admin', full_name: 'كيرلس إدوارد' };

const owner = { id: OWNER, full_name: 'أحمد سمير', avatar_url: null, approval_status: 'approved' };

/** One row of the list, as the website's page selects it. */
const row = {
  id: AGENT_ID,
  slug: 'ahmed-sales',
  years_experience: 4,
  visibility: 'public',
  availability: 'open_to_offers',
  restricted_at: null,
  created_at: '2026-10-20T10:00:00Z',
  profile: owner,
};

/** The profile as the page reads it: every column but the CV's path, the owner, and the developers it sold for. */
const agent = {
  id: AGENT_ID,
  user_id: OWNER,
  slug: 'ahmed-sales',
  headline_ar: 'مستشار مبيعات أولي',
  headline_en: null,
  years_experience: 4,
  tracks: ['primary', 'resale'],
  district_ids: [newCairo.id],
  languages: ['ar', 'en'],
  availability: 'open_to_offers',
  visibility: 'public',
  summary_ar: 'بشتغل في التجمع من ٢٠٢٢.',
  summary_en: null,
  units_closed: 12,
  volume_egp: null,
  restricted_at: null as string | null,
  restriction_reason: null as string | null,
  created_at: '2026-10-20T10:00:00Z',
  profile: owner,
  developers: [{ developer_id: 3 }],
};

let me: ProfileRow;
let file: typeof agent;
/** The list, and the page: both read agent_profiles, told apart by what they ask for. */
function agentProfiles(url: URL) {
  if (url.searchParams.get('id') === `eq.${AGENT_ID}`) return [file];
  return { body: [row], headers: { 'content-range': '0-0/1' } };
}

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  me = { ...adminProfile };
  file = { ...agent };
  server.on('GET /api/mobile/v1/config', mobileConfig({ adminMfaRequired: true }));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', () => [me]);
  server.on('POST /rest/v1/rpc/my_company_id', () => null);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  server.on('GET /rest/v1/agent_profiles', agentProfiles);
  // "CV uploaded": the count of this row with a path — one.
  server.on('HEAD /rest/v1/agent_profiles', { body: null, headers: { 'content-range': '*/1' } });
  server.on('GET /rest/v1/reports', []);
  server.on('GET /rest/v1/admin_audit_log', []);
  server.on('GET /rest/v1/moderation_notes', []);
  server.on('GET /rest/v1/districts', [newCairo]);
  server.on('GET /rest/v1/developers', [{ id: 3, name_ar: 'بالم هيلز', name_en: 'Palm Hills', slug: 'palm-hills' }]);
  server.on('POST /api/mobile/v1/actions/setAgentRestriction', { ok: true });

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
  '(tabs)/_layout': () => <DeclaredTabs routes={app} />,
  '(tabs)/(home)/index': stand('home'),
  '(tabs)/(admin)/admin/index': stand('the overview'),
  '(tabs)/(admin)/admin/agents/index': AgentsScreen,
  '(tabs)/(admin)/admin/agents/[id]': AgentScreen,
  '(tabs)/(admin)/admin/users/[id]': stand('the account file'),
  '(tabs)/(admin)/agents/[slug]': stand('the public page'),
  mfa: stand('the code screen'),
};

function actionsCalled(name: string) {
  return server.requests.filter((request) => request.method === 'POST' && request.url.pathname === `/api/mobile/v1/actions/${name}`);
}

/** What the list last asked agent_profiles for: the query string, as PostgREST reads it. */
function lastList() {
  const request = server.requests.filter((item) => item.method === 'GET' && item.url.pathname === '/rest/v1/agent_profiles' && item.url.searchParams.has('limit')).at(-1);
  return request ? Object.fromEntries(request.url.searchParams) : undefined;
}

/** The sheet's own confirm button: the last one with the lever's label, after the one on the screen that opened it. */
function confirmButton(label: string) {
  return screen.getAllByRole('button', { name: label }).at(-1)!;
}

/** Nothing the console reads names a phone, an email or the CV's path. */
function expectNothingPrivateAskedFor() {
  for (const request of server.requests) {
    const selected = request.url.searchParams.get('select') ?? '';
    expect(selected).not.toMatch(/cv_path|whatsapp_phone|email/);
    // The CV's existence is a count of rows with a path (a filter), never the path (a column).
    if (request.url.searchParams.has('cv_path')) expect(request.method).toBe('HEAD');
    expect(JSON.stringify(request.body ?? null)).not.toMatch(/cv_path|whatsapp_phone|"email"/);
  }
}

describe('the consultant profiles', () => {
  it('draws every profile newest first, searches a slug as a slug and a name as a name, and asks for each view the way the website does', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/agents' });

    expect(await screen.findByText('أحمد سمير')).toBeTruthy();
    expect(screen.getByText('ahmed-sales')).toBeTruthy();
    expect(screen.getByText(ar.admin.approval.approved)).toBeTruthy();
    // The view's chip, and the row's own badge.
    expect(screen.getAllByText(ar.visibility.public)).toHaveLength(2);
    // Every profile, whatever its visibility; the owner joined, so a name search can filter on it.
    expect(lastList()).toMatchObject({ order: 'created_at.desc,id.asc', limit: '25', offset: '0' });
    expect(lastList()?.select).toContain('profile:profiles!inner(id,full_name,avatar_url,approval_status)');
    expect(lastList()).not.toHaveProperty('visibility');
    expect(lastList()).not.toHaveProperty('restricted_at');

    const field = screen.getByLabelText(ar.filters.search);
    expect(field.props.placeholder).toBe(ar.admin.agentsSearchPlaceholder);
    // Letters, digits and dashes: a slug.
    fireEvent.changeText(field, ' ahmed-sales ');
    fireEvent(field, 'submitEditing');
    await waitFor(() => expect(lastList()).toMatchObject({ slug: 'ilike.%ahmed-sales%' }));
    expect(lastList()).not.toHaveProperty('profile.full_name');
    // Anything else: the owner's name, with the letters Arabic spells more than one way left open.
    fireEvent.changeText(field, 'أحمد');
    fireEvent(field, 'submitEditing');
    await waitFor(() => expect(lastList()).toMatchObject({ 'profile.full_name': 'ilike.%_حمد%' }));
    expect(lastList()).not.toHaveProperty('slug');

    fireEvent.press(screen.getByRole('radio', { name: ar.visibility.hidden }));
    await waitFor(() => expect(lastList()).toMatchObject({ visibility: 'eq.hidden' }));
    fireEvent.press(screen.getByRole('radio', { name: ar.admin.restricted }));
    await waitFor(() => expect(lastList()).toMatchObject({ restricted_at: 'not.is.null' }));
    expect(lastList()).not.toHaveProperty('visibility');

    expectNothingPrivateAskedFor();
  });

  it('opens the view a website link names, and marks a restricted profile', async () => {
    server.on('GET /rest/v1/agent_profiles', () => ({
      body: [{ ...row, visibility: 'hidden', restricted_at: '2026-10-21T10:00:00Z' }],
      headers: { 'content-range': '0-0/1' },
    }));
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/agents?visibility=restricted' });

    expect(await screen.findByText('أحمد سمير')).toBeTruthy();
    expect(lastList()).toMatchObject({ restricted_at: 'not.is.null' });
    expect(screen.getByRole('radio', { name: ar.admin.restricted }).props.accessibilityState).toMatchObject({ checked: true });
    // The row's own badge says restricted, not hidden.
    expect(screen.getAllByText(ar.admin.restricted)).toHaveLength(2);
    expect(screen.getAllByText(ar.visibility.hidden)).toHaveLength(1);
  });

  it('asks for the next twenty-five from where the last page ended, and stops at the total', async () => {
    const page = (offset: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        ...row,
        id: `00000000-0000-4000-8000-${String(offset + i).padStart(12, '0')}`,
        slug: `agent-${offset + i}`,
        profile: { ...owner, full_name: `استشاري ${offset + i}` },
      }));
    server.on('GET /rest/v1/agent_profiles', (url: URL) => {
      const offset = Number(url.searchParams.get('offset'));
      return offset === 0
        ? { body: page(0, 25), headers: { 'content-range': '0-24/30' } }
        : { body: page(25, 5), headers: { 'content-range': '25-29/30' } };
    });
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/agents' });

    expect(await screen.findByText('استشاري 0')).toBeTruthy();
    expect(lastList()).toMatchObject({ limit: '25', offset: '0' });

    await act(async () => screen.UNSAFE_getByType(FlashList).props.onEndReached());
    await waitFor(() => expect(lastList()).toMatchObject({ limit: '25', offset: '25' }));

    // Thirty of thirty: the end is the end.
    await act(async () => screen.UNSAFE_getByType(FlashList).props.onEndReached());
    expect(server.requests.filter((item) => item.method === 'GET' && item.url.pathname === '/rest/v1/agent_profiles')).toHaveLength(2);
  });

  it('says a search found nobody, and that a failed read failed — never that nothing is waiting', async () => {
    await signIn();
    server.on('GET /rest/v1/agent_profiles', (url: URL) =>
      url.searchParams.has('slug') ? { body: [], headers: { 'content-range': '*/0' } } : { status: 503, body: { code: 'PGRST002', message: 'schema cache' } },
    );
    await renderRouter(app, { initialUrl: '/admin/agents' });

    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.admin.emptyQueue)).toBeNull();

    const field = screen.getByLabelText(ar.filters.search);
    fireEvent.changeText(field, 'nobody');
    fireEvent(field, 'submitEditing');
    expect(await screen.findByText(ar.admin.searchNothing)).toBeTruthy();
  });
});

describe("a consultant's profile", () => {
  it('shows the profile as the directory would, the owner, the reports, and says only whether a CV was uploaded', async () => {
    server.on('GET /rest/v1/reports', [
      { id: 'r1', reason: 'impersonation', detail: 'ده مش هو.', status: 'open', created_at: '2026-10-21T10:00:00Z', reporter: { id: REPORTER, full_name: 'منى علي' } },
    ]);
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/agents/${AGENT_ID}` });

    // The name twice: the header, and the owner's row.
    expect(await screen.findAllByText('أحمد سمير')).toHaveLength(2);
    expect(screen.getByText('مستشار مبيعات أولي')).toBeTruthy();
    expect(screen.getByText('ahmed-sales')).toBeTruthy();
    // The ids resolved to names: the district and the developer are the app's own taxonomies.
    expect(await screen.findByText(newCairo.name_ar)).toBeTruthy();
    expect(screen.getByText('بالم هيلز')).toBeTruthy();
    expect(screen.getByText(`${ar.track.primary}، ${ar.track.resale}`)).toBeTruthy();
    expect(screen.getByText(ar.availability.open_to_offers)).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    // CV uploaded: yes — from a count, never the path.
    expect(screen.getByText(ar.admin.hasCv)).toBeTruthy();
    expect(screen.getByText(ar.admin.yes)).toBeTruthy();
    expect(screen.getByText(ar.admin.contactOnAccount)).toBeTruthy();
    // The report, with its reporter named.
    expect(screen.getByText(ar.reportReason.impersonation)).toBeTruthy();
    expect(screen.getByText(ar.admin.reportStatus.open)).toBeTruthy();
    expect(screen.getByText('منى علي')).toBeTruthy();
    // The record, with its one lever.
    expect(screen.getByRole('button', { name: ar.app.admin.addNote })).toBeTruthy();

    const detail = server.requests.find((item) => item.method === 'GET' && item.url.pathname === '/rest/v1/agent_profiles' && item.url.searchParams.get('id') === `eq.${AGENT_ID}`);
    expect(detail?.url.searchParams.get('select')).toContain('restriction_reason');
    expect(detail?.url.searchParams.get('select')).not.toContain('*');
    const cv = server.requests.find((item) => item.method === 'HEAD' && item.url.pathname === '/rest/v1/agent_profiles');
    expect(Object.fromEntries(cv!.url.searchParams)).toMatchObject({ select: 'id', id: `eq.${AGENT_ID}`, cv_path: 'not.is.null' });
    const reports = server.asked('/rest/v1/reports')[0];
    expect(Object.fromEntries(reports.url.searchParams)).toMatchObject({ agent_id: `eq.${AGENT_ID}`, order: 'created_at.desc', limit: '50' });
    expectNothingPrivateAskedFor();

    // The public page: the app's own, for a profile the directory shows.
    fireEvent.press(screen.getByRole('button', { name: ar.admin.publicPage }));
    expect(await screen.findByText('the public page')).toBeTruthy();
  });

  it('restricts the profile through the website with the reason it is given, and the confirm starts enabled', async () => {
    let answer: (value: unknown) => void = () => {};
    server.on('POST /api/mobile/v1/actions/setAgentRestriction', () => new Promise((resolve) => (answer = resolve)));
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/agents/${AGENT_ID}` });

    fireEvent.press(await screen.findByRole('button', { name: ar.admin.restrictProfile }));
    expect(screen.queryByRole('button', { name: ar.admin.liftRestriction })).toBeNull();
    expect(await screen.findByText(ar.admin.restrictProfileBody)).toBeTruthy();
    const field = screen.getByLabelText(ar.admin.reasonToConsultant);
    expect(confirmButton(ar.admin.restrictProfile).props.accessibilityState?.disabled).toBe(false);

    fireEvent.changeText(field, 'انتحال شخصية');
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.restrictProfile));
    });
    await waitFor(() => expect(actionsCalled('setAgentRestriction')).toHaveLength(1));
    expect(actionsCalled('setAgentRestriction')[0].body).toEqual({ input: { agentId: AGENT_ID, restrict: true, reason: 'انتحال شخصية' } });
    // Asked, not yet answered: nothing is said to be done.
    expect(shownToast()).toBeNull();
    await act(async () => {
      answer({ ok: true });
    });
    await waitFor(() => expect(shownToast()?.message).toBe(`تم: ${ar.admin.restrictProfile}`));
  });

  it('keeps a refusal in the sheet, in the website\'s words', async () => {
    server.on('POST /api/mobile/v1/actions/setAgentRestriction', { ok: false, error: 'forbidden' });
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/agents/${AGENT_ID}` });

    fireEvent.press(await screen.findByRole('button', { name: ar.admin.restrictProfile }));
    fireEvent.changeText(await screen.findByLabelText(ar.admin.reasonToConsultant), 'انتحال شخصية');
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.restrictProfile));
    });
    expect(await screen.findByText(ar.admin.errors.forbidden)).toBeTruthy();
    expect(shownToast()).toBeNull();
  });

  it('offers a restricted profile the lift alone, with the reason on the record, and no public page', async () => {
    file = { ...agent, visibility: 'hidden', restricted_at: '2026-10-21T10:00:00Z', restriction_reason: 'انتحال شخصية' };
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/agents/${AGENT_ID}` });

    expect(await screen.findAllByText('أحمد سمير')).toHaveLength(2);
    expect(screen.getByText(/«انتحال شخصية»/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.admin.restrictProfile })).toBeNull();
    expect(screen.queryByRole('button', { name: ar.admin.publicPage })).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: ar.admin.liftRestriction }));
    expect(await screen.findByText(ar.admin.liftRestrictionBody)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(ar.admin.reasonLabel), 'اتأكدنا إنه هو');
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.liftRestriction));
    });
    await waitFor(() => expect(actionsCalled('setAgentRestriction')).toHaveLength(1));
    expect(actionsCalled('setAgentRestriction')[0].body).toEqual({ input: { agentId: AGENT_ID, restrict: false, reason: 'اتأكدنا إنه هو' } });
  });

  it('offers no public page for a hidden profile, which the directory would refuse to show', async () => {
    file = { ...agent, visibility: 'hidden' };
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/agents/${AGENT_ID}` });
    expect(await screen.findAllByText('أحمد سمير')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: ar.admin.publicPage })).toBeNull();
    expect(screen.getByRole('button', { name: ar.admin.restrictProfile })).toBeTruthy();
  });

  it('says a profile that could not be read could not be read, with a retry', async () => {
    server.on('GET /rest/v1/agent_profiles', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/agents/${AGENT_ID}` });
    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.common.notFound)).toBeNull();
  });
});
