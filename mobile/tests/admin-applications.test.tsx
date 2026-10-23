import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlashList } from '@shopify/flash-list';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ProfileRow } from '@/lib/supabase/database.types';
import { DecisionSheetHost } from '~/components/admin/decision-sheet';
import { toast } from '~/components/feedback/toast';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as ApplicationsScreen from '../src/app/(tabs)/(admin)/admin/applications/index';
import * as ApplicationScreen from '../src/app/(tabs)/(admin)/admin/applications/[id]';
import { DeclaredTabs } from './declared-tabs';
import { authSession, authUser, mobileConfig, profile, totpFactor, USER_ID } from './auth-fixtures';
import { company } from './fixtures';
import { fakeServer } from './server';

/*
  The applications in the console — the website's /admin/applications and
  one application's page, both read-only — as the real screens draw them
  against stand-ins for Supabase and the website: the list and its views
  (each one query over applications, the unopened ones oldest first), the
  filters a link carries, the page's facts and the moves it made, the
  employer's notes as a count alone — and no lever anywhere, no CV, no
  phone, no email.
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
const CANDIDATE = '8b7c7f1e-0000-4000-8000-000000000099';
const JOB_ID = '5b0c7d1e-0000-4000-8000-000000000301';
const APPLICATION_ID = 'ab1c7d1e-0000-4000-8000-000000000701';

const adminProfile: ProfileRow = { ...profile, role: 'admin', full_name: 'كيرلس إدوارد' };

/** One row of the list, as the website's page selects it. */
const row = {
  id: APPLICATION_ID,
  status: 'new',
  created_at: '2026-10-10T10:00:00Z',
  employer_viewed_at: null,
  job: { id: JOB_ID, title_ar: 'مستشار مبيعات', title_en: null, company: { name_ar: company.name_ar, name_en: null } },
  candidate: { id: CANDIDATE, full_name: 'أحمد سمير' },
};

/** The application as the page reads it. */
const application = {
  id: APPLICATION_ID,
  status: 'shortlisted',
  note: 'عندي خبرة في التجمع.',
  decision_note: 'هنكلمك الأسبوع الجاي.',
  experience_band: 'junior_1_3',
  created_at: '2026-10-10T10:00:00Z',
  employer_viewed_at: '2026-10-12T09:00:00Z',
  job: { id: JOB_ID, title_ar: 'مستشار مبيعات', title_en: null, status: 'active', expires_at: null, company: { id: company.id, name_ar: company.name_ar, name_en: null } },
  candidate: { id: CANDIDATE, full_name: 'أحمد سمير', approval_status: 'approved' },
};

const events = [
  { id: 1, from_status: null, to_status: 'new', created_at: '2026-10-10T10:00:00Z', actor: { full_name: 'أحمد سمير', role: 'candidate' } },
  { id: 2, from_status: 'new', to_status: 'shortlisted', created_at: '2026-10-12T09:30:00Z', actor: { full_name: 'هالة فؤاد', role: 'employer' } },
];

let me: ProfileRow;

/** The list, and the page: both read applications, told apart by what they ask for. */
function applications(url: URL) {
  if (url.searchParams.get('id') === `eq.${APPLICATION_ID}`) return [application];
  return { body: [row], headers: { 'content-range': '0-0/1' } };
}

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
  server.on('GET /rest/v1/applications', applications);
  server.on('GET /rest/v1/application_events', events);
  // The employer's private notes: three of them, and not a word.
  server.on('HEAD /rest/v1/application_notes', { body: null, headers: { 'content-range': '*/3' } });
  server.on('GET /rest/v1/admin_audit_log', []);
  server.on('GET /rest/v1/moderation_notes', []);

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  toast.hide();
  jest.mocked(WebBrowser.openBrowserAsync).mockClear();
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
  '(tabs)/(admin)/admin/applications/index': ApplicationsScreen,
  '(tabs)/(admin)/admin/applications/[id]': ApplicationScreen,
  '(tabs)/(admin)/admin/users/[id]': stand('the account file'),
  '(tabs)/(admin)/admin/jobs/[id]': stand('the listing'),
  mfa: stand('the code screen'),
};

/** What the list last asked applications for: the query string, as PostgREST reads it. */
function lastList() {
  const request = server.requests.filter((item) => item.method === 'GET' && item.url.pathname === '/rest/v1/applications' && item.url.searchParams.has('limit')).at(-1);
  return request ? Object.fromEntries(request.url.searchParams) : undefined;
}

/** Nothing the console reads names the CV, a phone or an email, and nothing it does is a website action. */
function expectReadOnlyAndPrivate() {
  for (const request of server.requests) {
    expect(request.url.searchParams.get('select') ?? '').not.toMatch(/cv_path|whatsapp_phone|email/);
    expect(request.url.pathname).not.toMatch(/^\/api\/cv|\/api\/mobile\/v1\/actions\//);
  }
}

describe('the applications', () => {
  it('draws every application newest first, searches a name or an id, and asks for each view the way the website does', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/applications' });

    expect(await screen.findByText('أحمد سمير')).toBeTruthy();
    expect(screen.getByText('مستشار مبيعات')).toBeTruthy();
    expect(screen.getByText(company.name_ar)).toBeTruthy();
    // The view's chip, and the row's own badge.
    expect(screen.getAllByText(ar.applicationStatus.new)).toHaveLength(2);
    expect(screen.getByText(`${ar.admin.colOpened}: ${ar.admin.notOpened}`)).toBeTruthy();
    // The lede and the banner: nothing is changed from here.
    expect(screen.getByText(ar.admin.applicationsLede)).toBeTruthy();
    expect(screen.getByText(ar.admin.applicationReadOnly)).toBeTruthy();
    expect(screen.queryByText(ar.admin.filteredToOne)).toBeNull();

    expect(lastList()).toMatchObject({ order: 'created_at.desc,id.asc', limit: '25', offset: '0' });
    expect(lastList()?.select).toContain('job:jobs!inner(id,title_ar,title_en,company:companies(name_ar,name_en))');
    expect(lastList()?.select).toContain('candidate:profiles!inner(id,full_name)');
    expect(lastList()).not.toHaveProperty('status');

    const field = screen.getByLabelText(ar.filters.search);
    expect(field.props.placeholder).toBe(ar.admin.applicationsSearchPlaceholder);
    fireEvent.changeText(field, 'أحمد');
    fireEvent(field, 'submitEditing');
    await waitFor(() => expect(lastList()).toMatchObject({ 'candidate.full_name': 'ilike.%_حمد%' }));
    // An id is looked up as itself.
    fireEvent.changeText(field, APPLICATION_ID);
    fireEvent(field, 'submitEditing');
    await waitFor(() => expect(lastList()).toMatchObject({ id: `eq.${APPLICATION_ID}` }));
    expect(lastList()).not.toHaveProperty('candidate.full_name');

    fireEvent.press(screen.getByRole('radio', { name: ar.applicationStatus.hired }));
    await waitFor(() => expect(lastList()).toMatchObject({ status: 'eq.hired' }));

    // Unopened: new, never opened, more than a week old — and the oldest first.
    const before = Date.now();
    fireEvent.press(screen.getByRole('radio', { name: ar.admin.unopenedTab }));
    await waitFor(() => expect(lastList()).toMatchObject({ status: 'eq.new', employer_viewed_at: 'is.null', order: 'created_at.asc,id.asc' }));
    const cutoff = new Date(lastList()!.created_at.replace(/^lt\./, '')).getTime();
    expect(before - cutoff).toBeGreaterThanOrEqual(7 * 86_400_000 - 1);
    expect(before - cutoff).toBeLessThan(7 * 86_400_000 + 60_000);

    expectReadOnlyAndPrivate();
  });

  it("opens the view and the listing a website link names, and shows all again on request", async () => {
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/applications?status=unopened&job=${JOB_ID}` });

    expect(await screen.findByText('أحمد سمير')).toBeTruthy();
    expect(lastList()).toMatchObject({ job_id: `eq.${JOB_ID}`, status: 'eq.new', employer_viewed_at: 'is.null', order: 'created_at.asc,id.asc' });
    expect(screen.getByRole('radio', { name: ar.admin.unopenedTab }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByText(ar.admin.filteredToOne)).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: ar.admin.clearFilter }));
    await waitFor(() => expect(lastList()).not.toHaveProperty('job_id'));
    expect(screen.queryByText(ar.admin.filteredToOne)).toBeNull();
  });

  it("filters to one candidate's applications, and ignores a filter that is no id", async () => {
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/applications?candidate=${CANDIDATE}&job=not-an-id` });

    expect(await screen.findByText('أحمد سمير')).toBeTruthy();
    expect(lastList()).toMatchObject({ candidate_id: `eq.${CANDIDATE}` });
    expect(lastList()).not.toHaveProperty('job_id');
  });

  it('asks for the next twenty-five from where the last page ended, and stops at the total', async () => {
    const page = (offset: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        ...row,
        id: `00000000-0000-4000-8000-${String(offset + i).padStart(12, '0')}`,
        candidate: { id: CANDIDATE, full_name: `متقدم ${offset + i}` },
      }));
    server.on('GET /rest/v1/applications', (url: URL) => {
      const offset = Number(url.searchParams.get('offset'));
      return offset === 0
        ? { body: page(0, 25), headers: { 'content-range': '0-24/30' } }
        : { body: page(25, 5), headers: { 'content-range': '25-29/30' } };
    });
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/applications' });

    expect(await screen.findByText('متقدم 0')).toBeTruthy();
    expect(lastList()).toMatchObject({ limit: '25', offset: '0' });

    await act(async () => screen.UNSAFE_getByType(FlashList).props.onEndReached());
    await waitFor(() => expect(lastList()).toMatchObject({ limit: '25', offset: '25' }));

    // Thirty of thirty: the end is the end.
    await act(async () => screen.UNSAFE_getByType(FlashList).props.onEndReached());
    expect(server.asked('/rest/v1/applications')).toHaveLength(2);
  });

  it('says a search found nothing, and that a failed read failed — never that nothing is waiting', async () => {
    await signIn();
    server.on('GET /rest/v1/applications', (url: URL) =>
      url.searchParams.has('candidate.full_name')
        ? { body: [], headers: { 'content-range': '*/0' } }
        : { status: 503, body: { code: 'PGRST002', message: 'schema cache' } },
    );
    await renderRouter(app, { initialUrl: '/admin/applications' });

    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.admin.emptyQueue)).toBeNull();

    const field = screen.getByLabelText(ar.filters.search);
    fireEvent.changeText(field, 'منى');
    fireEvent(field, 'submitEditing');
    expect(await screen.findByText(ar.admin.searchNothing)).toBeTruthy();
  });
});

describe('an application', () => {
  it('shows what happened to it — the facts, the parties, every move — with the employer\'s notes as a count and no lever', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/applications/${APPLICATION_ID}` });

    // The candidate's name twice: the header, and the parties.
    expect(await screen.findAllByText('أحمد سمير')).toHaveLength(2);
    expect(screen.getByText(ar.admin.applicationReadOnly)).toBeTruthy();
    expect(screen.getAllByText(ar.applicationStatus.shortlisted).length).toBeGreaterThan(0);
    expect(screen.getByText(ar.experienceBand.junior_1_3)).toBeTruthy();
    expect(screen.getByText('هنكلمك الأسبوع الجاي.')).toBeTruthy();
    expect(screen.getByText('عندي خبرة في التجمع.')).toBeTruthy();
    expect(screen.getByText(ar.admin.employerNotes)).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText(APPLICATION_ID)).toBeTruthy();
    // The parties, each a link.
    expect(screen.getByText(company.name_ar)).toBeTruthy();
    expect(screen.getByText(ar.jobStatus.active)).toBeTruthy();
    // Every move, oldest first, with who made it.
    expect(screen.getByText(`${ar.applicationStatus.new} ← ${ar.applicationStatus.shortlisted}`)).toBeTruthy();
    expect(screen.getByText(/هالة فؤاد \(/)).toBeTruthy();
    expect(screen.getByText(/أحمد سمير \(/)).toBeTruthy();
    // The record and its note, and nothing that moves the application.
    expect(screen.getByRole('button', { name: ar.app.admin.addNote })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.admin.approve })).toBeNull();
    expect(screen.queryByRole('button', { name: ar.admin.reject })).toBeNull();

    // What was asked: the application without its CV, its moves oldest first, the notes counted and never read.
    const detail = server.asked('/rest/v1/applications')[0];
    expect(detail.url.searchParams.get('select')).toContain('decision_note');
    expect(detail.url.searchParams.get('select')).not.toContain('*');
    expect(Object.fromEntries(server.asked('/rest/v1/application_events')[0].url.searchParams)).toMatchObject({ application_id: `eq.${APPLICATION_ID}`, order: 'created_at.asc' });
    const notes = server.asked('/rest/v1/application_notes');
    expect(notes).toHaveLength(1);
    expect(notes[0].method).toBe('HEAD');
    expect(server.asked('/rest/v1/admin_audit_log')[0].url.searchParams.get('target_type')).toBe('eq.application');
    expectReadOnlyAndPrivate();

    // The candidate opens their account; the listing its review.
    fireEvent.press(screen.getByRole('link', { name: 'أحمد سمير' }));
    expect(await screen.findByText('the account file')).toBeTruthy();
  });

  it('opens the listing from the parties', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/applications/${APPLICATION_ID}` });
    fireEvent.press(await screen.findByRole('link', { name: 'مستشار مبيعات' }));
    expect(await screen.findByText('the listing')).toBeTruthy();
  });

  it('says a history that could not be read could not be read, with a retry', async () => {
    server.on('GET /rest/v1/application_events', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/applications/${APPLICATION_ID}` });
    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.admin.trailEmpty)).toBeNull();
    expect(screen.queryByText(ar.common.notFound)).toBeNull();
  });
});
