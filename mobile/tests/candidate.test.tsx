import type { ReactNode } from 'react';
import { Alert, Text, View, type AlertButton } from 'react-native';
import { router, Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { createTranslator } from 'use-intl';
import type { InterviewInviteRow, NotificationRow } from '@/lib/supabase/database.types';
import { shownToast, STAY_WITH_ACTION_MS } from '~/components/feedback/toast';
import { PendingPath } from '~/components/navigation/pending-path';
import { SessionGate } from '~/components/navigation/session-gate';
import { HeaderBell, useHeaderBell } from '~/components/notifications/header-bell';
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
import * as TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)/_layout';
import * as NotificationsScreen from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)/notifications';
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
let interviews: InterviewInviteRow[] = [];
let feed: NotificationRow[] = [];

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  applications = [application()];
  interviews = [];
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
  server.on('GET /rest/v1/interview_invites', () => interviews);
  server.on('POST /api/mobile/v1/actions/answerInterview', { ok: true });
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

/** What a tab's header is given at its trailing end (useHeaderBell): the bell, or nothing at all. */
function BellItem() {
  return <Text>{useHeaderBell() ? 'header item: the bell' : 'header item: none'}</Text>;
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
      <BellItem />
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
    const result = await renderRouter(app, { initialUrl: '/' });

    const bell = await screen.findByRole('button', { name: ar.notifications.title });
    await waitFor(() => expect(bell.props.accessibilityValue).toMatchObject({ text: 'تنبيه واحد غير مقروء' }));
    expect(screen.getByText('header item: the bell')).toBeTruthy();
    // Counted as the website counts it: the reader's own, unread.
    const count = server.asked('/rest/v1/notifications').find((request) => request.method === 'HEAD');
    expect(count?.url.searchParams.get('user_id')).toBe(`eq.${USER_ID}`);
    expect(count?.url.searchParams.get('read_at')).toBe('is.null');

    fireEvent.press(bell);
    await waitFor(() => expect(result.getPathname()).toBe('/notifications'));
    expect(await screen.findByText('طلبك على مستشار مبيعات أصبح: قائمة مختصرة')).toBeTruthy();
    expect(screen.getByText('وصل طلبك على «مستشار مبيعات»')).toBeTruthy();
  });

  it('is not there for somebody signed out', async () => {
    await renderRouter(app, { initialUrl: '/' });
    expect(await screen.findByText('home screen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.notifications.title })).toBeNull();
    // Not even an empty place for it: iOS 26 draws one as a glass circle with nothing in it.
    expect(screen.getByText('header item: none')).toBeTruthy();
    expect(server.asked('/rest/v1/notifications')).toHaveLength(0);
  });
});

describe('the feed', () => {
  it('asks for the newest page, without the applicants folded into another row', async () => {
    await signedIn();
    await renderRouter(app, { initialUrl: '/notifications' });
    await screen.findByText('طلبك على مستشار مبيعات أصبح: قائمة مختصرة');

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
    await renderRouter(app, { initialUrl: '/notifications' });
    expect(await screen.findByText('طلبك على مستشار مبيعات أصبح: قائمة مختصرة')).toBeTruthy();
  });

  it('follows a notification to where it points, through the website', async () => {
    await signedIn();
    const result = await renderRouter(app, { initialUrl: '/notifications' });
    fireEvent.press(await screen.findByText('طلبك على مستشار مبيعات أصبح: قائمة مختصرة'));

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
    const result = await renderRouter(app, { initialUrl: '/notifications' });

    fireEvent.press(await screen.findByText('النيل للوساطة نشرت وظيفتين جديدتين'));
    await waitFor(() => expect(result.getPathname()).toBe('/companies/nile-brokers'));
    expect(screen.getByText('company page')).toBeTruthy();
    expect(bodyOf('/api/mobile/v1/actions/openNotification')).toEqual({ input: { id: feed[0].id } });
  });

  it('goes back to the page the bell was opened from when that is where it leads, rather than a second copy', async () => {
    await signedIn();
    const result = await renderRouter(app, { initialUrl: '/dashboard/applications' });
    await waitFor(() => expect(result.getSegments()).toEqual(['(tabs)', '(applications)', 'dashboard', 'applications']));
    act(() => router.push('/notifications'));
    fireEvent.press(await screen.findByText('طلبك على مستشار مبيعات أصبح: قائمة مختصرة'));

    await waitFor(() => expect(result.getPathname()).toBe('/dashboard/applications'));
    // One screen in the tab: Back does not show the feed again.
    act(() => router.back());
    expect(result.getPathname()).not.toBe('/notifications');
  });

  it('leaves the reader where they went when the answer comes after they left the feed', async () => {
    let answer: (value: unknown) => void = () => {};
    server.on('POST /api/mobile/v1/actions/openNotification', () => new Promise((resolve) => (answer = resolve)));
    await signedIn();
    const result = await renderRouter(app, { initialUrl: '/dashboard/applications' });
    await waitFor(() => expect(result.getSegments()).toEqual(['(tabs)', '(applications)', 'dashboard', 'applications']));
    act(() => router.push('/notifications'));
    fireEvent.press(await screen.findByText('طلبك على مستشار مبيعات أصبح: قائمة مختصرة'));
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
    await renderRouter(app, { initialUrl: '/notifications?link=gone' });
    expect(await screen.findByText(ar.notifications.linkGone)).toBeTruthy();
  });

  it('says so when the page a notification pointed at is gone', async () => {
    await signedIn();
    server.on('POST /api/mobile/v1/actions/openNotification', { ok: true, data: { fallback: '/notifications?link=gone' } });
    const result = await renderRouter(app, { initialUrl: '/notifications' });
    fireEvent.press(await screen.findByText('وصل طلبك على «مستشار مبيعات»'));

    expect(await screen.findByText(ar.notifications.linkGone)).toBeTruthy();
    expect(result.getPathname()).toBe('/notifications');
  });

  it('marks everything read up to the newest row it showed', async () => {
    await signedIn();
    await renderRouter(app, { initialUrl: '/notifications' });
    fireEvent.press(await screen.findByRole('button', { name: ar.notifications.markAllRead }));

    await waitFor(() => expect(server.asked('/rest/v1/rpc/mark_notifications_read')).toHaveLength(1));
    expect(bodyOf('/rest/v1/rpc/mark_notifications_read')).toEqual({ p_up_to: feed[0].created_at });
    // A boolean, not the element: a failing check would print the whole screen, every try.
    await waitFor(() => expect(screen.queryByText(ar.notifications.markAllRead) === null).toBe(true));
  });

  it('deletes one row from VoiceOver once its Undo has gone, and puts it back when the database refuses', async () => {
    let refuse = true;
    server.on('DELETE /rest/v1/notifications', (url) => {
      if (refuse) return { status: 500, body: { message: 'down' } };
      feed = feed.filter((row) => !String(url).includes(row.id));
      return { status: 204, body: null };
    });
    await signedIn();
    await renderRouter(app, { initialUrl: '/notifications' });
    await screen.findByText(ar.notifications.markAllRead);
    const rows = () => screen.UNSAFE_root.findAll((node) => typeof node.type === 'string' && Array.isArray(node.props.accessibilityActions) && node.props.accessibilityActions.some((a: { label: string }) => a.label === ar.app.notificationsFeed.delete));
    await waitFor(() => expect(rows().length).toBe(2));
    const action = (index: number) => {
      const row = rows()[index];
      const name = row.props.accessibilityActions[0].name;
      act(() => row.props.onAccessibilityAction({ nativeEvent: { actionName: name } }));
    };

    const deletes = () => server.asked('/rest/v1/notifications').filter((request) => request.method === 'DELETE');
    // Off the list at once, with Undo; nothing is deleted while the Undo is offered.
    const swipe = (index: number) => {
      jest.useFakeTimers();
      action(index);
    };
    const waitOut = () => {
      act(() => jest.advanceTimersByTime(STAY_WITH_ACTION_MS));
      jest.useRealTimers();
    };

    swipe(0);
    expect(rows().length).toBe(1);
    expect(shownToast()?.message).toBe(ar.app.notificationsFeed.deleted);
    expect(deletes()).toHaveLength(0);
    // Undone: back, and never sent.
    act(() => shownToast()?.action?.onPress());
    waitOut();
    expect(rows().length).toBe(2);
    expect(deletes()).toHaveLength(0);

    // Left to go, it is deleted; refused, it comes back and the toast says so.
    swipe(0);
    waitOut();
    await waitFor(() => expect(shownToast()?.message).toBe(ar.app.notificationsFeed.deleteFailed));
    expect(shownToast()?.tone).toBe('destructive');
    await waitFor(() => expect(rows().length).toBe(2));
    expect(String(deletes()[0].url)).toContain(`id=eq.${feed[0].id}`);
    expect(String(deletes()[0].url)).toContain('user_id=eq.');

    refuse = false;
    swipe(0);
    waitOut();
    await waitFor(() => expect(deletes()).toHaveLength(2));
    await waitFor(() => expect(rows().length).toBe(1));
  });

  it('clears everything shown only after asking', async () => {
    server.on('DELETE /rest/v1/notifications', () => {
      feed = [];
      return { status: 204, body: null };
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await signedIn();
    await renderRouter(app, { initialUrl: '/notifications' });
    fireEvent.press(await screen.findByRole('button', { name: ar.app.notificationsFeed.clearAll }));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(server.asked('/rest/v1/notifications').some((request) => request.method === 'DELETE')).toBe(false);
    act(() => (alert.mock.calls[0][2] as AlertButton[]).find((button) => button.style === 'destructive')?.onPress?.());
    await waitFor(() => expect(server.asked('/rest/v1/notifications').some((request) => request.method === 'DELETE')).toBe(true));
    const asked = server.asked('/rest/v1/notifications').find((request) => request.method === 'DELETE');
    expect(decodeURIComponent(String(asked?.url))).toContain('created_at=lte.2026-09-27');
    expect(await screen.findByText(ar.app.notificationsFeed.empty)).toBeTruthy();
    alert.mockRestore();
  });

  it('says a quiet feed is quiet, and points a candidate at the board', async () => {
    feed = [];
    await signedIn();
    await renderRouter(app, { initialUrl: '/notifications' });
    expect(await screen.findByText(ar.app.notificationsFeed.empty)).toBeTruthy();
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
  const tAr = createTranslator({ locale: 'ar', messages: catalogues.ar });
  const DAY = 24 * 60 * 60 * 1000;

  it('says a week and more without an answer, how soon the company usually answers, and offers to withdraw there', async () => {
    applications = [
      application({
        created_at: new Date(Date.now() - 9 * DAY).toISOString(),
        job: { ...JOB, company: { ...JOB.company, id: 'c0000000-0000-4000-8000-000000000001' } },
      }),
    ];
    server.on('POST /rest/v1/rpc/company_response_stats', [{ sample: 12, open_rate: 0.9, median_days: 3.6 }]);
    await signedIn();
    await renderRouter(app, { initialUrl: '/dashboard/applications' });

    const strip = `${tAr.markup('app.applications.quietFor', { days: 9, v: (chunks) => `\u2066${chunks}\u2069` })} · ${tAr.markup(
      'app.applications.usuallyIn',
      { days: 4, v: (chunks) => `\u2066${chunks}\u2069` },
    )}`;
    expect(await screen.findByText(strip)).toBeTruthy();
    // The way out once, there: not again under the row.
    expect(screen.getAllByRole('button', { name: ar.dashboard.withdraw })).toHaveLength(1);
    expect(server.asked('/rest/v1/rpc/company_response_stats')[0].body).toEqual({ p_company_id: 'c0000000-0000-4000-8000-000000000001' });
  });

  it('says nothing of waiting under a week, or once the company has moved it', async () => {
    applications = [
      application({ created_at: new Date(Date.now() - 3 * DAY).toISOString() }),
      application({
        id: 'a0000000-0000-4000-8000-000000000002',
        status: 'shortlisted',
        created_at: new Date(Date.now() - 20 * DAY).toISOString(),
        events: [{ from_status: 'new', to_status: 'shortlisted', created_at: new Date(Date.now() - 1 * DAY).toISOString() }],
      }),
    ];
    await signedIn();
    await renderRouter(app, { initialUrl: '/dashboard/applications' });
    expect((await screen.findAllByRole('button', { name: ar.dashboard.withdraw })).length).toBe(2);
    expect(screen.queryByText(/لم تردّ بعد/)).toBeNull();
    // Moved: when, beside when it was sent.
    expect(screen.getByText(new RegExp(`^${ar.app.applications.movedAgo.replace('{when}', '.+')} · `))).toBeTruthy();
  });

  it('shows all, those with news this week, the interviews or the ended, as the segments choose', async () => {
    applications = [
      application({ id: 'a0000000-0000-4000-8000-000000000011', job: { ...JOB, title_ar: 'وظيفة جديدة' } }),
      application({
        id: 'a0000000-0000-4000-8000-000000000012',
        status: 'interview',
        job: { ...JOB, title_ar: 'وظيفة مقابلة' },
        events: [{ from_status: 'shortlisted', to_status: 'interview', created_at: new Date(Date.now() - DAY).toISOString() }],
      }),
      application({ id: 'a0000000-0000-4000-8000-000000000013', status: 'rejected', job: { ...JOB, title_ar: 'وظيفة منتهية' } }),
    ];
    await signedIn();
    await renderRouter(app, { initialUrl: '/dashboard/applications' });
    expect(await screen.findByText('وظيفة منتهية')).toBeTruthy();

    fireEvent.press(screen.getByRole('radio', { name: tAr.markup('app.applications.segmentNews', { count: 1, v: (chunks) => `\u2066${chunks}\u2069` }) }));
    expect(screen.getByText('وظيفة مقابلة')).toBeTruthy();
    expect(screen.queryByText('وظيفة منتهية')).toBeNull();
    fireEvent.press(screen.getByRole('radio', { name: ar.app.applications.segmentEnded }));
    expect(screen.getByText('وظيفة منتهية')).toBeTruthy();
    expect(screen.queryByText('وظيفة مقابلة')).toBeNull();
  });

  it('keeps a record of an application a company deleted with its account, under its own heading', async () => {
    server.on('GET /rest/v1/application_records', [
      {
        id: 1,
        candidate_id: 'x',
        job_title_ar: 'مستشار عقاري',
        job_title_en: null,
        company_name_ar: 'شركة أُغلقت',
        company_name_en: null,
        applied_at: '2026-08-01T10:00:00Z',
        last_status: 'shortlisted',
        ended_at: '2026-10-01T10:00:00Z',
        reason: 'company_deleted',
      },
    ]);
    await signedIn();
    await renderRouter(app, { initialUrl: '/dashboard/applications' });
    expect(await screen.findByText(ar.app.closure.recordsHeading)).toBeTruthy();
    expect(screen.getByText('مستشار عقاري')).toBeTruthy();
    expect(screen.getByText(`شركة أُغلقت · ${ar.applicationStatus.shortlisted}`)).toBeTruthy();
    // Not under "with news": it is history.
    fireEvent.press(screen.getByRole('radio', { name: ar.app.applications.segmentInterviews }));
    expect(screen.queryByText(ar.app.closure.recordsHeading)).toBeNull();
  });

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
    await renderRouter(app, { initialUrl: '/dashboard/applications' });

    expect(await screen.findByText(ar.dashboard.applicationOpened)).toBeTruthy();
    // The badge, and the timeline's last step.
    expect(screen.getAllByText(ar.applicationStatus.rejected)).toHaveLength(2);
    expect(screen.getByText(ar.dashboard.decisionFromCompany)).toBeTruthy();
    expect(screen.getByText('نبحث عن خبرة أطول في السوق الأولي.')).toBeTruthy();
    expect(screen.getByText(ar.dashboard.applicationListingClosed)).toBeTruthy();
    // Withdrawing only while the outcome is open: the new one and the shortlisted one.
    expect(screen.getAllByRole('button', { name: ar.dashboard.withdraw })).toHaveLength(2);

    const read = server.asked('/rest/v1/applications')[0];
    expect(read.url.searchParams.get('candidate_id')).toBe(`eq.${USER_ID}`);
  });

  it('asks before withdrawing, in the app’s own direction, then withdraws through the website', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await signedIn();
    await renderRouter(app, { initialUrl: '/dashboard/applications' });
    fireEvent.press(await screen.findByRole('button', { name: ar.dashboard.withdraw }));

    // Drawn by the app, right to left: not iOS's alert, which an English iPhone lays out left to right.
    expect(await screen.findByText('تسحب طلبك على «مستشار مبيعات»؟')).toBeTruthy();
    expect(screen.getByText(ar.myApplications.withdrawBody)).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
    expect(server.asked('/api/mobile/v1/actions/withdrawApplication')).toHaveLength(0);

    fireEvent.press(screen.getByTestId('confirm-action'));

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
    await renderRouter(app, { initialUrl: '/dashboard/applications' });
    fireEvent.press(await screen.findByRole('button', { name: ar.dashboard.withdraw }));
    fireEvent.press(await screen.findByTestId('confirm-action'));

    expect((await screen.findAllByText(ar.applicationStatus.hired)).length).toBeGreaterThan(0);
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
    await renderRouter(app, { initialUrl: '/dashboard/applications' });
    fireEvent.press(await screen.findByRole('button', { name: ar.dashboard.withdraw }));
    fireEvent.press(await screen.findByTestId('confirm-action'));

    expect(await screen.findByText(ar.dashboard.emptyApplications)).toBeTruthy();
    alert.mockRestore();
  });

  it('never says "you have not applied" when the read failed', async () => {
    server.on('GET /rest/v1/applications', { status: 500, body: { message: 'boom' } });
    await signedIn();
    await renderRouter(app, { initialUrl: '/dashboard/applications' });
    expect(await screen.findByText(ar.common.error)).toBeTruthy();
    expect(screen.queryByText(ar.dashboard.emptyApplications)).toBeNull();
  });
});

describe('signing in on the way somewhere', () => {
  it("lands a candidate on their applications once the app has been drawn for them", async () => {
    const result = await renderRouter(app, { initialUrl: '/sign-in?next=%2Fdashboard%2Fapplications' });
    fireEvent.changeText(await screen.findByLabelText(ar.auth.email), user.email);
    fireEvent.changeText(screen.getByLabelText(ar.auth.password), PASSWORD);
    fireEvent.press(await screen.findByRole('button', { name: ar.auth.signIn, disabled: false }));

    await waitFor(() => expect(result.getPathname()).toBe('/dashboard/applications'));
    expect(result.getSegments()).toEqual(['(tabs)', '(applications)', 'dashboard', 'applications']);
    expect(await screen.findByText('مستشار مبيعات')).toBeTruthy();
  });
});

describe('an interview invitation', () => {
  const invite = (overrides: Partial<InterviewInviteRow> = {}): InterviewInviteRow => ({
    id: 'b0000000-0000-4000-8000-000000000009',
    application_id: applications[0]?.id as string,
    starts_at: '2099-11-02T09:00:00Z',
    minutes: 30,
    mode: 'video',
    place: 'https://meet.example.com/abc',
    note: 'أحضر نسخة من سيرتك.',
    status: 'proposed',
    counter_starts_at: null,
    created_by: null,
    created_at: '2026-10-29T10:00:00Z',
    updated_at: '2026-10-29T10:00:00Z',
    ...overrides,
  });

  it('shows when, how and where, and sends the answer', async () => {
    applications = [application({ status: 'interview' })];
    interviews = [invite()];
    await signedIn();
    await renderRouter(app, { initialUrl: '/dashboard/applications' });
    expect(await screen.findByTestId('interview-candidate')).toBeTruthy();
    expect(screen.getByText('«أحضر نسخة من سيرتك.»')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: ar.app.interview.accept }));
    await waitFor(() =>
      expect(server.asked('/api/mobile/v1/actions/answerInterview')[0]?.body).toMatchObject({ input: { id: interviews[0]?.id, answer: 'accepted' } }),
    );
  });

  it('proposes another time, in Cairo time', async () => {
    applications = [application({ status: 'interview' })];
    interviews = [invite()];
    await signedIn();
    await renderRouter(app, { initialUrl: '/dashboard/applications' });
    fireEvent.press(await screen.findByRole('button', { name: ar.app.interview.proposeOther }));
    fireEvent.press(await screen.findByRole('button', { name: ar.app.interview.counterSend }));
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/answerInterview')).toHaveLength(1));
    const body = server.asked('/api/mobile/v1/actions/answerInterview')[0]?.body as { input: { answer: string; counterStartsAt: string } };
    expect(body.input.answer).toBe('counter');
    expect(body.input.counterStartsAt).toMatch(/T11:00:00\+0[23]:00$/);
  });

  it('says what they answered once they have', async () => {
    applications = [application({ status: 'interview' })];
    interviews = [invite({ status: 'counter', counter_starts_at: '2099-11-03T10:00:00Z' })];
    await signedIn();
    await renderRouter(app, { initialUrl: '/dashboard/applications' });
    expect(await screen.findByTestId('interview-candidate')).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.app.interview.accept })).toBeNull();
  });
});
