import type { ReactNode } from 'react';
import { Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { SavedSearchRow } from '@/lib/supabase/database.types';
import { PendingPath } from '~/components/navigation/pending-path';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { tabsFor } from '~/lib/tabs';
import { ThemeProvider } from '~/theme/provider';
import * as AuthLayout from '../src/app/(auth)/_layout';
import * as SignInScreen from '../src/app/(auth)/sign-in/index';
import * as TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
import * as CompanyScreen from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/companies/[slug]';
import * as JobScreen from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/jobs/[slug]';
import * as BoardScreen from '../src/app/(tabs)/(jobs)/jobs/index';
import * as SavedScreen from '../src/app/(tabs)/(saved)/dashboard/saved/index';
import { authSession, authUser, mobileConfig, profile, USER_ID } from './auth-fixtures';
import { board, browse, cairo, companyPage, jobPage, listing, newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  What a candidate keeps — bookmarks, saved searches, follows — against
  stand-ins for Supabase and the website: the real screens, the real client and
  session. What is checked is which of the website's actions run with what,
  what shows at once, and what shows when the server says no.
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

function search(overrides: Partial<SavedSearchRow> = {}): SavedSearchRow {
  return {
    id: 's0000000-0000-4000-8000-000000000001',
    candidate_id: USER_ID,
    label: 'بيع أول في التجمع',
    query: 'track=primary',
    alerts: true,
    created_at: '2026-09-20T10:00:00Z',
    last_sent_at: null,
    last_checked_at: null,
    ...overrides,
  };
}

let savedIds: Set<string>;
let searches: SavedSearchRow[];

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  savedIds = new Set();
  searches = [];

  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', [profile]);
  server.on('/rest/v1/districts', [newCairo]);
  server.on('/rest/v1/governorates', [cairo]);
  server.on('/api/mobile/v1/browse', browse);
  server.on('/api/mobile/v1/jobs', board());
  server.on(`/api/mobile/v1/jobs/${listing.slug}`, jobPage);
  server.on('/api/mobile/v1/companies/nile-brokers', companyPage);
  server.on('POST /api/mobile/v1/actions/recordJobView', { ok: true });
  server.on('GET /rest/v1/applications', []);
  // Two reads of one table: the ids behind every bookmark, and the list itself.
  server.on('GET /rest/v1/saved_jobs', (url) =>
    url.searchParams.get('select') === 'job_id'
      ? [...savedIds].map((job_id) => ({ job_id }))
      : [...savedIds].map(() => ({ created_at: '2026-09-25T10:00:00Z', job: listing })),
  );
  server.on('GET /rest/v1/saved_searches', () => searches);
  server.on('POST /api/mobile/v1/actions/toggleSavedJob', (_url, init) => {
    const { input } = JSON.parse(String(init?.body));
    if (savedIds.has(input.jobId)) savedIds.delete(input.jobId);
    else savedIds.add(input.jobId);
    return { ok: true, data: { saved: savedIds.has(input.jobId) } };
  });
  server.on('POST /api/mobile/v1/actions/setSearchAlerts', (_url, init) => {
    const { input } = JSON.parse(String(init?.body));
    searches = searches.map((row) => (row.id === input.id ? { ...row, alerts: input.alerts } : row));
    return { ok: true };
  });
  server.on('POST /api/mobile/v1/actions/deleteSavedSearch', (_url, init) => {
    const { input } = JSON.parse(String(init?.body));
    searches = searches.filter((row) => row.id !== input.id);
    return { ok: true };
  });
  server.on('POST /api/mobile/v1/actions/saveSearch', { ok: true, data: { id: 's-new' } });
  server.on('POST /api/mobile/v1/actions/followCompany', (_url, init) => {
    const { input } = JSON.parse(String(init?.body));
    searches = [search({ id: 's-follow', label: input.label, query: `company=${input.slug}` }), ...searches];
    return { ok: true, data: { id: 's-follow' } };
  });

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  server.requests.length = 0;
});

/** A returning candidate: signed in, and remembered by the phone. */
async function signedIn() {
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
  await rememberActor({ userId: USER_ID, profile: { role: 'candidate', approval_status: 'approved' }, company: null });
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
              <PendingPath />
            </Settled>
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function TabBar() {
  const tabs = tabsFor(useSession().actor);
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="(jobs)" />
      <Tabs.Protected guard={tabs.includes('saved')}>
        <Tabs.Screen name="(saved)" />
      </Tabs.Protected>
    </Tabs>
  );
}

const SHARED = '(tabs)/(jobs,saved)';

const app = {
  _layout: { default: Root, unstable_settings: { anchor: '(tabs)' } },
  '(tabs)/_layout': TabBar,
  [`${SHARED}/_layout`]: TabStack,
  [`${SHARED}/jobs/[slug]`]: JobScreen,
  [`${SHARED}/companies/[slug]`]: CompanyScreen,
  '(tabs)/(jobs)/jobs/index': BoardScreen,
  '(tabs)/(saved)/dashboard/saved/index': SavedScreen,
  '(auth)/_layout': AuthLayout,
  '(auth)/sign-in/index': SignInScreen,
};

const bodyOf = (path: string, index = 0) => server.asked(path)[index]?.body as Record<string, unknown> | undefined;
const gone = (text: string) => screen.queryByText(text) === null;

describe('bookmarks', () => {
  it('keeps a listing from the listing page, and says it is kept', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: `/jobs/${listing.slug}` });
    fireEvent.press(await screen.findByRole('button', { name: ar.jobs.save }));

    await waitFor(() => expect(bodyOf('/api/mobile/v1/actions/toggleSavedJob')).toEqual({ input: { jobId: listing.id } }));
    expect(await screen.findByRole('button', { name: ar.jobs.saved })).toBeTruthy();
  });

  it('keeps a bookmark whose answer was lost, rather than putting it back for a second press to undo', async () => {
    let pressed = false;
    server.on('GET /rest/v1/saved_jobs', (url) => {
      // The one listing asked about, or every bookmark — which, after the press, cannot be read.
      const one = url.searchParams.get('job_id')?.replace(/^eq\./, '');
      if (pressed && !one) return { status: 503, body: { message: 'upstream unavailable' } };
      const ids = [...savedIds].filter((id) => !one || id === one);
      return url.searchParams.get('select') === 'job_id'
        ? ids.map((job_id) => ({ job_id }))
        : ids.map(() => ({ created_at: '2026-09-25T10:00:00Z', job: listing }));
    });
    // The website keeps it, and its answer never reaches the phone.
    server.on('POST /api/mobile/v1/actions/toggleSavedJob', (_url, init) => {
      pressed = true;
      savedIds.add(JSON.parse(String(init?.body)).input.jobId);
      throw new TypeError('Network request failed');
    });
    await signedIn();
    renderRouter(app, { initialUrl: `/jobs/${listing.slug}` });
    await screen.findByRole('button', { name: ar.jobs.save });
    // Pressable once the bookmarks are known: the website's action is a toggle.
    await waitFor(() => expect(screen.getByRole('button', { name: ar.jobs.save }).props.accessibilityState?.busy).toBeFalsy());
    fireEvent.press(screen.getByRole('button', { name: ar.jobs.save }));

    expect(await screen.findByRole('button', { name: ar.jobs.saved })).toBeTruthy();
    // Settled on what the database holds, and not sent twice.
    await waitFor(() => expect(screen.getByRole('button', { name: ar.jobs.saved }).props.accessibilityState?.busy).toBeFalsy());
    expect(server.asked('/api/mobile/v1/actions/toggleSavedJob')).toHaveLength(1);
  });

  it('sends somebody signed out to sign in, and back to the listing', async () => {
    const result = renderRouter(app, { initialUrl: `/jobs/${listing.slug}` });
    fireEvent.press(await screen.findByRole('button', { name: ar.jobs.save }));

    await waitFor(() => expect(result.getPathname()).toBe('/sign-in'));
    expect(result.getSearchParams()).toEqual({ next: `/jobs/${listing.slug}` });
    expect(server.asked('/api/mobile/v1/actions/toggleSavedJob')).toHaveLength(0);
  });

  it('lists what is kept, and lets a card give its bookmark back', async () => {
    savedIds.add(listing.id);
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/saved' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();

    fireEvent.press(await screen.findByRole('button', { name: ar.jobs.removeSaved }));
    await waitFor(() => expect(bodyOf('/api/mobile/v1/actions/toggleSavedJob')).toEqual({ input: { jobId: listing.id } }));
    expect(await screen.findByText(ar.dashboard.emptySaved)).toBeTruthy();
  });

  it('puts an ended listing under its own heading, and keeps it', async () => {
    savedIds.add(listing.id);
    server.on('GET /rest/v1/saved_jobs', (url) =>
      url.searchParams.get('select') === 'job_id'
        ? [{ job_id: listing.id }]
        : [{ created_at: '2026-09-25T10:00:00Z', job: { ...listing, expires_at: '2026-09-01T00:00:00Z' } }],
    );
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/saved' });
    expect(await screen.findByText(ar.dashboard.savedClosedHeading)).toBeTruthy();
    expect(screen.getByText(ar.dashboard.savedClosedLede)).toBeTruthy();
    expect(screen.getByText(listing.title_ar)).toBeTruthy();
  });
});

describe('saved searches and follows', () => {
  it("switches one's weekly email off, and deletes another, through the website", async () => {
    searches = [search(), search({ id: 's0000000-0000-4000-8000-000000000002', label: 'نايل بروكرز', query: 'company=nile-brokers' })];
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/saved' });

    const switches = await screen.findAllByRole('button', { name: ar.savedSearch.alertsOn });
    fireEvent.press(switches[0]);
    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/setSearchAlerts')).toEqual({ input: { id: searches[0].id, alerts: false } }),
    );
    expect(await screen.findByRole('button', { name: ar.savedSearch.alertsOff })).toBeTruthy();

    // A follow is the same row, and says so where it is undone.
    fireEvent.press(screen.getByRole('button', { name: ar.savedSearch.unfollow }));
    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/deleteSavedSearch')).toEqual({ input: { id: 's0000000-0000-4000-8000-000000000002' } }),
    );
    await waitFor(() => expect(gone('نايل بروكرز')).toBe(true));
  });

  it('puts a switch back when the server refuses it', async () => {
    searches = [search()];
    server.on('POST /api/mobile/v1/actions/setSearchAlerts', { ok: false, error: 'forbidden' });
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/saved' });

    fireEvent.press(await screen.findByRole('button', { name: ar.savedSearch.alertsOn }));
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/setSearchAlerts')).toHaveLength(1));
    expect(await screen.findByRole('button', { name: ar.savedSearch.alertsOn })).toBeTruthy();
  });

  it('saves a narrowed board under the name the reader gives it', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: '/jobs?track=primary' });

    fireEvent.press(await screen.findByRole('button', { name: ar.savedSearch.cta }));
    const name = await screen.findByLabelText(ar.savedSearch.labelField);
    // Named after what the board is narrowed by, until the reader says otherwise.
    expect(name.props.value).toBe(ar.track.primary);
    fireEvent.changeText(name, 'بيع أول في التجمع');
    fireEvent.press(screen.getByRole('button', { name: ar.common.save }));

    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/saveSearch')).toEqual({ input: { label: 'بيع أول في التجمع', query: 'track=primary' } }),
    );
    expect(await screen.findByText(ar.savedSearch.saved)).toBeTruthy();
  });

  it('says when the ten searches and follows are used up', async () => {
    server.on('POST /api/mobile/v1/actions/saveSearch', { ok: false, error: 'cap' });
    await signedIn();
    renderRouter(app, { initialUrl: '/jobs?track=primary' });

    fireEvent.press(await screen.findByRole('button', { name: ar.savedSearch.cta }));
    fireEvent.press(await screen.findByRole('button', { name: ar.common.save }));
    expect(await screen.findByText(ar.savedSearch.cap)).toBeTruthy();
  });

  it('does not offer to save the whole board', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: '/jobs' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.savedSearch.cta })).toBeNull();
  });

  it('follows a company from its page', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: '/companies/nile-brokers' });

    fireEvent.press(await screen.findByRole('button', { name: ar.companies.follow }));
    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/followCompany')).toEqual({ input: { slug: 'nile-brokers', label: 'نايل بروكرز' } }),
    );
    expect(await screen.findByRole('button', { name: ar.companies.following })).toBeTruthy();
    expect(screen.getByText(ar.companies.followingHint)).toBeTruthy();
  });

  it('says why a follow did not happen, and shows it did not', async () => {
    server.on('POST /api/mobile/v1/actions/followCompany', { ok: false, error: 'cap' });
    await signedIn();
    renderRouter(app, { initialUrl: '/companies/nile-brokers' });

    fireEvent.press(await screen.findByRole('button', { name: ar.companies.follow }));
    expect(await screen.findByText(ar.companies.followCap)).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.companies.follow })).toBeTruthy();
  });
});
