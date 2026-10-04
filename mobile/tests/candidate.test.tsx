import type { ReactNode } from 'react';
import { Alert, Text, View, type AlertButton } from 'react-native';
import { router, Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { NotificationRow } from '@/lib/supabase/database.types';
import { PendingPath } from '~/components/navigation/pending-path';
import { SessionGate } from '~/components/navigation/session-gate';
import { HeaderBell } from '~/components/notifications/header-bell';
import type { CandidateApplication } from '~/features/applications/queries';
import { feedPage } from '~/features/notifications/queries';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { tabsFor } from '~/lib/tabs';
import { ThemeProvider } from '~/theme/provider';
import * as AuthLayout from '../src/app/(auth)/_layout';
import * as SignInScreen from '../src/app/(auth)/sign-in/index';
import * as TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
import * as NotificationsScreen from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/notifications';
import * as ApplicationsScreen from '../src/app/(tabs)/(applications)/dashboard/applications/index';
import { authSession, authUser, mobileConfig, profile, USER_ID } from './auth-fixtures';
import { fakeServer } from './server';

/*
  A candidate's own screens — the bell, the feed, the applications — against
  stand-ins for Supabase and the website, signed in with the real client and
  the real session provider. What is checked is what the database is asked,
  which of the website's actions run, and where each tap leaves the person.
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
const PASSWORD = 'correct-horse';
const user = authUser();

const JOB = {
  slug: 'sales-a1b2',
  status: 'active' as const,
  expires_at: '2099-01-01T00:00:00Z',
  title_ar: 'مستشار مبيعات',
  title_en: null,
  company: { name_ar: 'النيل للوساطة', name_en: null, slug: 'nile-brokers' },
  district: { name_ar: 'القاهرة الجديدة', name_en: 'New Cairo' },
};

function application(overrides: Partial<CandidateApplication> = {}): CandidateApplication {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    job_id: 'b0000000-0000-4000-8000-000000000001',
    status: 'new',
    created_at: '2026-09-20T10:00:00Z',
    decision_note: null,
    employer_viewed_at: null,
    job: JOB,
    ...overrides,
  };
}

function notification(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: 'n0000000-0000-4000-8000-000000000001',
    user_id: USER_ID,
    kind: 'application_moved',
    payload: { title_ar: 'مستشار مبيعات', status: 'shortlisted', slug: 'sales-a1b2' },
    href: '/dashboard/applications',
    read_at: null,
    created_at: '2026-09-27T09:00:00.123456+00:00',
    dedupe_key: null,
    folded_into: null,
    ...overrides,
  };
}

let applications: CandidateApplication[] = [];
let feed: NotificationRow[] = [];

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  applications = [application()];
  feed = [
    notification(),
    notification({
      id: 'n0000000-0000-4000-8000-000000000002',
      kind: 'application_submitted',
      payload: { title_ar: 'مستشار مبيعات', slug: 'sales-a1b2' },
      href: '/jobs/sales-a1b2',
      read_at: '2026-09-26T12:00:00Z',
      created_at: '2026-09-26T09:00:00Z',
    }),
  ];

  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', [profile]);
  server.on('GET /rest/v1/applications', () => applications);
  server.on('GET /rest/v1/notifications', () => feed);
  server.on('HEAD /rest/v1/notifications', () => ({
    body: null,
    headers: { 'content-range': `*/${feed.filter((row) => !row.read_at).length}` },
  }));
  server.on('POST /rest/v1/rpc/mark_notifications_read', () => {
    feed = feed.map((row) => ({ ...row, read_at: row.read_at ?? '2026-09-28T10:00:00Z' }));
    return 1;
  });
  server.on('POST /api/mobile/v1/actions/openNotification', { ok: true, data: { href: '/dashboard/applications' } });
  server.on('POST /api/mobile/v1/actions/withdrawApplication', () => {
    applications = [];
    return { ok: true };
  });

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  server.requests.length = 0;
});

/** A returning candidate: signed in, and remembered by the phone from the last launch. */
async function signedIn() {
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
  await rememberActor({ userId: USER_ID, profile: { role: 'candidate', approval_status: 'approved' }, company: null });
  server.requests.length = 0;
}

/** As the root layout does: nothing is drawn until the phone has said who it remembers. */
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
              <SessionGate />
              <PendingPath />
            </Settled>
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/** The tab bar, drawn for whoever the session says — with the real tabsFor. */
function TabBar() {
  const tabs = tabsFor(useSession().actor);
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="(home)" />
      <Tabs.Protected guard={tabs.includes('applications')}>
        <Tabs.Screen name="(applications)" />
      </Tabs.Protected>
    </Tabs>
  );
}

const SHARED = '(tabs)/(home,applications)';

const app = {
  _layout: { default: Root, unstable_settings: { anchor: '(tabs)' } },
  '(tabs)/_layout': TabBar,
  [`${SHARED}/_layout`]: TabStack,
  [`${SHARED}/notifications`]: NotificationsScreen,
  [`${SHARED}/jobs/[slug]`]: () => <Text>listing page</Text>,
  [`${SHARED}/companies/[slug]`]: () => <Text>company page</Text>,
  '(tabs)/(home)/index': () => (
    <View>
      <Text>home screen</Text>
      <HeaderBell />
    </View>
  ),
  '(tabs)/(applications)/dashboard/applications/index': ApplicationsScreen,
  '(auth)/_layout': AuthLayout,
  '(auth)/sign-in/index': SignInScreen,
};

const bodyOf = (path: string, index = 0) => server.asked(path)[index]?.body as Record<string, unknown> | undefined;

describe('the bell', () => {
  it('says how many are unread, and opens the feed', async () => {
    await signedIn();
    const result = renderRouter(app, { initialUrl: '/' });

    const bell = await screen.findByRole('button', { name: ar.notifications.title });
    await waitFor(() => expect(bell.props.accessibilityValue).toMatchObject({ text: '1 غير مقروء' }));
    // Counted as the website counts it: the reader's own, unread.
    const count = server.asked('/rest/v1/notifications').find((request) => request.method === 'HEAD');
    expect(count?.url.searchParams.get('user_id')).toBe(`eq.${USER_ID}`);
    expect(count?.url.searchParams.get('read_at')).toBe('is.null');

    fireEvent.press(bell);
    await waitFor(() => expect(result.getPathname()).toBe('/notifications'));
    expect(await screen.findByText('طلبك في مستشار مبيعات بقى: قائمة مختصرة')).toBeTruthy();
    expect(screen.getByText('وصل طلبك على «مستشار مبيعات»')).toBeTruthy();
  });

  it('is not there for somebody signed out', async () => {
    renderRouter(app, { initialUrl: '/' });
    expect(await screen.findByText('home screen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.notifications.title })).toBeNull();
    expect(server.asked('/rest/v1/notifications')).toHaveLength(0);
  });
});

describe('the feed', () => {
  it('asks for the newest page, without the applicants folded into another row', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: '/notifications' });
    await screen.findByText('طلبك في مستشار مبيعات بقى: قائمة مختصرة');

    const page = server.asked('/rest/v1/notifications').find((request) => request.method === 'GET');
    expect(page?.url.searchParams.get('user_id')).toBe(`eq.${USER_ID}`);
    expect(page?.url.searchParams.get('folded_into')).toBe('is.null');
    expect(page?.url.searchParams.get('order')).toBe('created_at.desc,id.desc');
    expect(page?.url.searchParams.get('limit')).toBe('21');
  });

  it('reads the unfolded feed from a database that has not folded anything yet', async () => {
    await signedIn();
    server.on('GET /rest/v1/notifications', (url) =>
      url.searchParams.has('folded_into')
        ? { status: 400, body: { code: '42703', message: 'column notifications.folded_into does not exist' } }
        : feed,
    );
    renderRouter(app, { initialUrl: '/notifications' });
    expect(await screen.findByText('طلبك في مستشار مبيعات بقى: قائمة مختصرة')).toBeTruthy();
  });

  it('follows a notification to where it points, through the website', async () => {
    await signedIn();
    const result = renderRouter(app, { initialUrl: '/notifications' });
    fireEvent.press(await screen.findByText('طلبك في مستشار مبيعات بقى: قائمة مختصرة'));

    await waitFor(() => expect(result.getPathname()).toBe('/dashboard/applications'));
    expect(result.getSegments()).toEqual(['(tabs)', '(applications)', 'dashboard', 'applications']);
    expect(bodyOf('/api/mobile/v1/actions/openNotification')).toEqual({ input: { id: feed[0].id } });
  });

  it("tells of a followed company's new listings as the website does, and opens the company", async () => {
    feed = [
      notification({
        id: 'n0000000-0000-4000-8000-000000000003',
        kind: 'new_jobs',
        payload: { count: 2, source: 'follow', slug: 'nile-brokers', name_ar: 'النيل للوساطة', name_en: null },
        href: '/companies/nile-brokers',
      }),
    ];
    server.on('POST /api/mobile/v1/actions/openNotification', { ok: true, data: { href: '/companies/nile-brokers' } });
    await signedIn();
    const result = renderRouter(app, { initialUrl: '/notifications' });

    fireEvent.press(await screen.findByText('النيل للوساطة نزّلت وظيفتين جداد'));
    await waitFor(() => expect(result.getPathname()).toBe('/companies/nile-brokers'));
    expect(screen.getByText('company page')).toBeTruthy();
    expect(bodyOf('/api/mobile/v1/actions/openNotification')).toEqual({ input: { id: feed[0].id } });
  });

  it('goes back to the page the bell was opened from when that is where it leads, rather than a second copy', async () => {
    await signedIn();
    const result = renderRouter(app, { initialUrl: '/dashboard/applications' });
    await waitFor(() => expect(result.getSegments()).toEqual(['(tabs)', '(applications)', 'dashboard', 'applications']));
    act(() => router.push('/notifications'));
    fireEvent.press(await screen.findByText('طلبك في مستشار مبيعات بقى: قائمة مختصرة'));

    await waitFor(() => expect(result.getPathname()).toBe('/dashboard/applications'));
    // One screen in the tab: Back does not show the feed again.
    act(() => router.back());
    expect(result.getPathname()).not.toBe('/notifications');
  });

  it('leaves the reader where they went when the answer comes after they left the feed', async () => {
    let answer: (value: unknown) => void = () => {};
    server.on('POST /api/mobile/v1/actions/openNotification', () => new Promise((resolve) => (answer = resolve)));
    await signedIn();
    const result = renderRouter(app, { initialUrl: '/dashboard/applications' });
    await waitFor(() => expect(result.getSegments()).toEqual(['(tabs)', '(applications)', 'dashboard', 'applications']));
    act(() => router.push('/notifications'));
    fireEvent.press(await screen.findByText('طلبك في مستشار مبيعات بقى: قائمة مختصرة'));
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/openNotification')).toHaveLength(1));

    // A slow answer: the reader goes back and opens a listing meanwhile.
    act(() => router.back());
    act(() => router.push('/jobs/sales-a1b2'));
    expect(await screen.findByText('listing page')).toBeTruthy();
    await act(async () => {
      answer({ ok: true, data: { href: '/dashboard/applications' } });
      await jest.advanceTimersByTimeAsync(200);
    });
    // The listing they opened stays: nothing of the feed's answer moves it.
    expect(result.getPathname()).toBe('/jobs/sales-a1b2');
  });

  it('says why when a tapped push opened it for a page that is gone', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: '/notifications?link=gone' });
    expect(await screen.findByText(ar.notifications.linkGone)).toBeTruthy();
  });

  it('says so when the page a notification pointed at is gone', async () => {
    await signedIn();
    server.on('POST /api/mobile/v1/actions/openNotification', { ok: true, data: { fallback: '/notifications?link=gone' } });
    const result = renderRouter(app, { initialUrl: '/notifications' });
    fireEvent.press(await screen.findByText('وصل طلبك على «مستشار مبيعات»'));

    expect(await screen.findByText(ar.notifications.linkGone)).toBeTruthy();
    expect(result.getPathname()).toBe('/notifications');
  });

  it('marks everything read up to the newest row it showed', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: '/notifications' });
    fireEvent.press(await screen.findByRole('button', { name: ar.notifications.markAllRead }));

    await waitFor(() => expect(server.asked('/rest/v1/rpc/mark_notifications_read')).toHaveLength(1));
    expect(bodyOf('/rest/v1/rpc/mark_notifications_read')).toEqual({ p_up_to: feed[0].created_at });
    // A boolean, not the element: a failing check would print the whole screen, every try.
    await waitFor(() => expect(screen.queryByText(ar.notifications.markAllRead) === null).toBe(true));
  });

  it('says a quiet feed is quiet, and points a candidate at the board', async () => {
    feed = [];
    await signedIn();
    renderRouter(app, { initialUrl: '/notifications' });
    expect(await screen.findByText(ar.notifications.empty)).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.notifications.emptyCtaCandidate })).toBeTruthy();
  });
});

describe('paging the feed', () => {
  it('asks for the page after the last row by its time and id, never by an offset', async () => {
    await signedIn();
    const rows = Array.from({ length: 21 }, (_, index) =>
      notification({
        id: `n0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        created_at: new Date(Date.UTC(2026, 8, 27, 9, 0, 0) - index * 60_000).toISOString(),
      }),
    );
    server.on('GET /rest/v1/notifications', (url) => (url.searchParams.has('or') ? rows.slice(20) : rows));

    const first = await feedPage(USER_ID, null);
    expect(first.rows).toHaveLength(20);
    expect(first.next).toEqual({ createdAt: rows[19].created_at, id: rows[19].id });

    const second = await feedPage(USER_ID, first.next);
    expect(second.rows).toHaveLength(1);
    expect(second.next).toBeNull();
    const asked = server.asked('/rest/v1/notifications').at(-1);
    expect(asked?.url.searchParams.get('or')).toBe(
      `(created_at.lt."${rows[19].created_at}",and(created_at.eq."${rows[19].created_at}",id.lt.${rows[19].id}))`,
    );
  });
});

describe('the applications', () => {
  it('shows each one with where it stands, what the company said, and what became of the listing', async () => {
    applications = [
      application({ employer_viewed_at: '2026-09-21T10:00:00Z' }),
      application({
        id: 'a0000000-0000-4000-8000-000000000002',
        status: 'rejected',
        decision_note: 'نبحث عن خبرة أطول في السوق الأولي.',
      }),
      application({
        id: 'a0000000-0000-4000-8000-000000000003',
        status: 'shortlisted',
        job: { ...JOB, status: 'closed' },
      }),
    ];
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/applications' });

    expect(await screen.findByText(ar.dashboard.applicationOpened)).toBeTruthy();
    expect(screen.getByText(ar.applicationStatus.rejected)).toBeTruthy();
    expect(screen.getByText(ar.dashboard.decisionFromCompany)).toBeTruthy();
    expect(screen.getByText('نبحث عن خبرة أطول في السوق الأولي.')).toBeTruthy();
    expect(screen.getByText(ar.dashboard.applicationListingClosed)).toBeTruthy();
    // Withdrawing only while the outcome is open: the new one and the shortlisted one.
    expect(screen.getAllByRole('button', { name: ar.dashboard.withdraw })).toHaveLength(2);

    const read = server.asked('/rest/v1/applications')[0];
    expect(read.url.searchParams.get('candidate_id')).toBe(`eq.${USER_ID}`);
  });

  it('asks before withdrawing, then withdraws through the website', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/applications' });
    fireEvent.press(await screen.findByRole('button', { name: ar.dashboard.withdraw }));

    expect(alert).toHaveBeenCalledWith('تسحب طلبك على «مستشار مبيعات»؟', ar.app.applications.withdrawBody, expect.any(Array));
    expect(server.asked('/api/mobile/v1/actions/withdrawApplication')).toHaveLength(0);

    const buttons = alert.mock.calls[0][2] as AlertButton[];
    act(() => buttons.find((button) => button.style === 'destructive')?.onPress?.());

    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/withdrawApplication')).toHaveLength(1));
    expect(bodyOf('/api/mobile/v1/actions/withdrawApplication')).toEqual({
      input: { applicationId: 'a0000000-0000-4000-8000-000000000001' },
    });
    expect(await screen.findByText(ar.dashboard.emptyApplications)).toBeTruthy();
    alert.mockRestore();
  });

  it('reads them again when a withdrawal is refused, so the row says where it stands now', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    // The company moved it on while the list was open: the withdrawal is refused.
    server.on('POST /api/mobile/v1/actions/withdrawApplication', () => {
      applications = [application({ status: 'hired' })];
      return { ok: false, error: 'forbidden' };
    });
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/applications' });
    fireEvent.press(await screen.findByRole('button', { name: ar.dashboard.withdraw }));
    act(() => (alert.mock.calls[0][2] as AlertButton[]).find((button) => button.style === 'destructive')?.onPress?.());

    expect(await screen.findByText(ar.applicationStatus.hired)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.dashboard.withdraw })).toBeNull();
    alert.mockRestore();
  });

  it('takes the row away when the answer to a withdrawal was lost but it went in', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    server.on('POST /api/mobile/v1/actions/withdrawApplication', () => {
      applications = [];
      return { status: 502, body: { error: 'bad_gateway' } };
    });
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/applications' });
    fireEvent.press(await screen.findByRole('button', { name: ar.dashboard.withdraw }));
    act(() => (alert.mock.calls[0][2] as AlertButton[]).find((button) => button.style === 'destructive')?.onPress?.());

    expect(await screen.findByText(ar.dashboard.emptyApplications)).toBeTruthy();
    alert.mockRestore();
  });

  it('never says "you have not applied" when the read failed', async () => {
    server.on('GET /rest/v1/applications', { status: 500, body: { message: 'boom' } });
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/applications' });
    expect(await screen.findByText(ar.common.error)).toBeTruthy();
    expect(screen.queryByText(ar.dashboard.emptyApplications)).toBeNull();
  });
});

describe('signing in on the way somewhere', () => {
  it("lands a candidate on their applications once the app has been drawn for them", async () => {
    const result = renderRouter(app, { initialUrl: '/sign-in?next=%2Fdashboard%2Fapplications' });
    fireEvent.changeText(await screen.findByLabelText(ar.auth.email), user.email);
    fireEvent.changeText(screen.getByLabelText(ar.auth.password), PASSWORD);
    fireEvent.press(await screen.findByRole('button', { name: ar.auth.signIn, disabled: false }));

    await waitFor(() => expect(result.getPathname()).toBe('/dashboard/applications'));
    expect(result.getSegments()).toEqual(['(tabs)', '(applications)', 'dashboard', 'applications']);
    expect(await screen.findByText('مستشار مبيعات')).toBeTruthy();
  });
});
