import { NoteSheetHost } from '~/components/saved/note-sheet';
import type { ReactNode } from 'react';
import { DeviceEventEmitter, Linking, Modal, StyleSheet } from 'react-native';
import { Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { createTranslator } from 'use-intl';
import type { JobListItem } from '@/lib/job-list';
import { formatDateTime, formatList } from '@/lib/format';
import { shownToast, toast } from '~/components/feedback/toast';
import { localHrefOf, PushBridge } from '~/components/navigation/push-bridge';
import { PendingPath } from '~/components/navigation/pending-path';
import { hideJob, unhideJob } from '~/features/moderation/hidden-jobs';
import { bestOf, parseCompareIds, togglePick } from '~/features/saved/compare';
import { jobNotes, keepNote, NOTE_MAX } from '~/features/saved/notes';
import {
  closingInDays,
  forgetTakenRemindersForTests,
  jobReminders,
  reconcileReminders,
  reminderAt,
  reminderDay,
  setReminder,
  syncReminders,
  type ReminderWords,
} from '~/features/saved/reminders';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { markupTags } from '~/i18n/rich';
import { rememberActor } from '~/lib/last-actor';
import { openWhenReady } from '~/lib/open-path';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { tabsFor } from '~/lib/tabs';
import { ThemeProvider } from '~/theme/provider';
import * as TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
import * as JobScreen from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/jobs/[slug]';
import * as BoardScreen from '../src/app/(tabs)/(jobs)/jobs/index';
import * as CompareScreen from '../src/app/(tabs)/(saved)/dashboard/saved/compare';
import * as SavedScreen from '../src/app/(tabs)/(saved)/dashboard/saved/index';
import { authSession, authUser, mobileConfig, profile, USER_ID } from './auth-fixtures';
import { board, browse, cairo, jobPage, listing, newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  What a candidate does with the listings they kept, beyond keeping them:
  comparing two or three side by side, a private note on each, and a
  reminder the day before one closes — against stand-ins for Supabase, the
  website and the phone's notifications. What is checked is what is kept on
  the phone and for whom, what is asked of the system and when, and what
  the screens say.
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

// The phone's notifications, as tests/setup.ts has them, and the scheduling
// the reminders use: what is scheduled is held, so a test can see it set,
// taken back and put back.
jest.mock('expo-notifications', () => {
  const scheduled = new Map<string, { identifier: string; content: Record<string, unknown>; trigger: unknown }>();
  const counter = { next: 0 };
  const subscription = () => ({ remove: jest.fn() });
  return {
    __scheduled: scheduled,
    __counter: counter,
    DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
    SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
    IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
    AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn(async () => null),
    getPermissionsAsync: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    scheduleNotificationAsync: jest.fn(async (request: { content: Record<string, unknown>; trigger: unknown }) => {
      counter.next += 1;
      const identifier = `reminder-${counter.next}`;
      scheduled.set(identifier, { identifier, ...request });
      return identifier;
    }),
    cancelScheduledNotificationAsync: jest.fn(async (identifier: string) => {
      scheduled.delete(identifier);
    }),
    getAllScheduledNotificationsAsync: jest.fn(async () => [...scheduled.values()].map(({ identifier, content, trigger }) => ({ identifier, content, trigger }))),
    getExpoPushTokenAsync: jest.fn(async () => ({ type: 'expo', data: 'ExponentPushToken[test-token-0001]' })),
    addPushTokenListener: jest.fn(subscription),
    addNotificationReceivedListener: jest.fn(subscription),
    addNotificationResponseReceivedListener: jest.fn(subscription),
    getLastNotificationResponse: jest.fn(() => null),
    clearLastNotificationResponse: jest.fn(),
    setBadgeCountAsync: jest.fn(async () => true),
    dismissAllNotificationsAsync: jest.fn(async () => {}),
    unregisterForNotificationsAsync: jest.fn(async () => {}),
  };
});

const phone = jest.requireMock('expo-notifications') as {
  __scheduled: Map<string, { identifier: string; content: Record<string, unknown>; trigger: unknown }>;
  __counter: { next: number };
};

const ar = catalogues.ar;
const tAr = createTranslator({ locale: 'ar', messages: catalogues.ar });
const server = fakeServer();
const PASSWORD = 'correct-horse';
const user = authUser();
const DAY = 24 * 60 * 60 * 1000;

const undetermined = { status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' };
const granted = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
const denied = { status: 'denied', granted: false, canAskAgain: false, expires: 'never' };

/** A saved listing of the board's shape, closing `closesIn` from now. */
function job(id: string, overrides: Partial<JobListItem> = {}, closesIn = 30 * DAY): JobListItem {
  return {
    ...listing,
    id: `5b0c7d1e-0000-4000-8000-00000000020${id}`,
    slug: `saved-role-${id}`,
    title_ar: `وظيفة محفوظة ${id}`,
    expires_at: new Date(Date.now() + closesIn).toISOString(),
    ...overrides,
  };
}

let savedJobs: JobListItem[];

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  savedJobs = [];
  phone.__scheduled.clear();
  phone.__counter.next = 0;
  jest.mocked(Notifications.getPermissionsAsync).mockReset().mockResolvedValue(granted as never);
  jest.mocked(Notifications.requestPermissionsAsync).mockReset().mockResolvedValue(granted as never);
  jest.mocked(Notifications.scheduleNotificationAsync).mockClear();
  jest.mocked(Notifications.cancelScheduledNotificationAsync).mockClear();
  jest.mocked(Notifications.addNotificationResponseReceivedListener).mockClear();
  jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(null);
  jobNotes.resetForTests();
  jobReminders.resetForTests();
  forgetTakenRemindersForTests();
  toast.hide();

  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', [profile]);
  server.on('/rest/v1/districts', [newCairo]);
  server.on('/rest/v1/governorates', [cairo]);
  server.on('/api/mobile/v1/browse', browse);
  server.on('/api/mobile/v1/jobs', board());
  server.on(`/api/mobile/v1/jobs/${listing.slug}`, jobPage);
  server.on('POST /api/mobile/v1/actions/recordJobView', { ok: true });
  server.on('GET /rest/v1/applications', []);
  server.on('GET /rest/v1/saved_searches', []);
  server.on('GET /rest/v1/saved_jobs', (url) =>
    url.searchParams.get('select') === 'job_id'
      ? savedJobs.map((item) => ({ job_id: item.id }))
      : savedJobs.map((item) => ({ created_at: '2026-09-25T10:00:00Z', job: item })),
  );
  server.on('POST /api/mobile/v1/actions/toggleSavedJob', (_url, init) => {
    const { input } = JSON.parse(String(init?.body));
    const had = savedJobs.some((item) => item.id === input.jobId);
    if (had) savedJobs = savedJobs.filter((item) => item.id !== input.jobId);
    return { ok: true, data: { saved: !had } };
  });

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  server.requests.length = 0;
});

afterEach(() => toast.hide());

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
              <PushBridge />
              <NoteSheetHost />
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
  '(tabs)/(jobs)/jobs/index': BoardScreen,
  '(tabs)/(saved)/dashboard/saved/index': SavedScreen,
  '(tabs)/(saved)/dashboard/saved/compare': CompareScreen,
};

/** A sheet takes a moment to close (src/lib/use-sheet.ts) before another can open; renderRouter's clock is a fake one. */
const sheetClosed = () => act(() => jest.advanceTimersByTimeAsync(800));

const kept = async (key: string) => JSON.parse((await AsyncStorage.getItem(key)) ?? '[]') as Record<string, unknown>[];

/* ------------------------------------------------------------------------- */

describe('when to remind, on Cairo’s clock', () => {
  const at = (iso: string) => new Date(iso);

  it('is ten in the morning the day before the closing day, in summer time and out of it', () => {
    // October 2026, before the clocks go back: Cairo is UTC+3.
    expect(reminderAt('2026-10-15T12:00:00Z', at('2026-10-10T09:00:00Z'))?.toISOString()).toBe('2026-10-14T07:00:00.000Z');
    // December: UTC+2.
    expect(reminderAt('2026-12-10T12:00:00Z', at('2026-12-01T09:00:00Z'))?.toISOString()).toBe('2026-12-09T08:00:00.000Z');
  });

  it('counts the closing day on Cairo’s calendar, not UTC’s', () => {
    // 22:30 UTC on the 14th is half past one on the 15th in Cairo: the day before is the 14th.
    expect(reminderAt('2026-10-14T22:30:00Z', at('2026-10-10T09:00:00Z'))?.toISOString()).toBe('2026-10-14T07:00:00.000Z');
  });

  it('follows the clocks across a change: the night summer time ends, and the night it starts', () => {
    // Summer time ends at the end of Thursday 29 October 2026.
    expect(reminderAt('2026-10-30T10:00:00Z', at('2026-10-20T09:00:00Z'))?.toISOString()).toBe('2026-10-29T07:00:00.000Z');
    expect(reminderAt('2026-10-31T10:00:00Z', at('2026-10-20T09:00:00Z'))?.toISOString()).toBe('2026-10-30T08:00:00.000Z');
    // It starts at the beginning of Friday 24 April 2026.
    expect(reminderAt('2026-04-24T09:00:00Z', at('2026-04-10T09:00:00Z'))?.toISOString()).toBe('2026-04-23T08:00:00.000Z');
    expect(reminderAt('2026-04-25T09:00:00Z', at('2026-04-10T09:00:00Z'))?.toISOString()).toBe('2026-04-24T07:00:00.000Z');
  });

  it('is an hour from now once that morning has passed, while the listing is still open', () => {
    // Eleven in Cairo on the 14th; it closes at three on the 15th.
    expect(reminderAt('2026-10-15T12:00:00Z', at('2026-10-14T08:00:00Z'))?.toISOString()).toBe('2026-10-14T09:00:00.000Z');
    // On the closing day itself.
    expect(reminderAt('2026-10-15T20:00:00Z', at('2026-10-15T06:00:00Z'))?.toISOString()).toBe('2026-10-15T07:00:00.000Z');
  });

  it('is nothing when there is nothing left to remind of', () => {
    // Closing within the hour.
    expect(reminderAt('2026-10-15T12:00:00Z', at('2026-10-15T11:30:00Z'))).toBeNull();
    // Closed, or never closing.
    expect(reminderAt('2026-10-01T12:00:00Z', at('2026-10-10T09:00:00Z'))).toBeNull();
    expect(reminderAt(null, at('2026-10-10T09:00:00Z'))).toBeNull();
    expect(reminderAt('not a date', at('2026-10-10T09:00:00Z'))).toBeNull();
  });

  it('says how many Cairo days are left, today being nought', () => {
    // 23:30 in Cairo on the 14th, closing at eleven at night on the 15th: tomorrow.
    expect(closingInDays('2026-10-15T20:00:00Z', at('2026-10-14T20:30:00Z'))).toBe(1);
    // Half an hour later it is the 15th in Cairo (still the 14th in UTC): today.
    expect(closingInDays('2026-10-15T20:00:00Z', at('2026-10-14T21:30:00Z'))).toBe(0);
    expect(closingInDays('2026-10-18T09:00:00Z', at('2026-10-15T09:00:00Z'))).toBe(3);
    expect(closingInDays('2026-10-01T09:00:00Z', at('2026-10-15T09:00:00Z'))).toBeNull();
  });

  it('words the notification for the day it goes off', () => {
    expect(reminderDay(at('2026-10-14T07:00:00Z'), '2026-10-15T12:00:00Z')).toBe('tomorrow');
    expect(reminderDay(at('2026-10-15T07:00:00Z'), '2026-10-15T20:00:00Z')).toBe('today');
  });
});

/* ------------------------------------------------------------------------- */

describe('a reminder before a saved listing closes', () => {
  const words: ReminderWords = (day) => ({ title: day, body: 'body' });

  it('asks the phone first when it never has, then schedules it with the listing to open', async () => {
    const soon = job('1', {}, 5 * DAY);
    savedJobs = [soon];
    // Never asked, until the system's question is answered yes.
    let asked = false;
    jest.mocked(Notifications.getPermissionsAsync).mockImplementation(async () => (asked ? granted : undetermined) as never);
    jest.mocked(Notifications.requestPermissionsAsync).mockImplementation(async () => {
      asked = true;
      return granted as never;
    });
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/saved' });

    fireEvent.press(await screen.findByRole('button', { name: ar.app.saved.remind.setSpoken }));
    const when = reminderAt(soon.expires_at) as Date;
    await waitFor(() => expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1));
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: {
        title: tAr('app.saved.remind.notifyTitle', { day: 'tomorrow' }),
        body: tAr('app.saved.remind.notifyBody', { job: soon.title_ar, company: soon.company.name_ar }),
        sound: 'default',
        data: { localHref: `/jobs/${soon.slug}`, reminderFor: soon.id },
      },
      trigger: { type: 'date', date: when.getTime() },
    });

    // Said, with the way to take it back; and the card's bell says it is set.
    const said = tAr('app.saved.remind.when', { when: formatDateTime(when, 'ar') });
    await waitFor(() => expect(shownToast()).toMatchObject({ message: said, action: { label: ar.common.cancel } }));
    expect(await screen.findByRole('button', { name: said })).toBeTruthy();
    // Kept for this person, with the system's id to cancel it by.
    expect(await kept(`bc.saved-reminders.v1:${USER_ID}`)).toEqual([
      expect.objectContaining({ id: soon.id, slug: soon.slug, notificationId: 'reminder-1', fireAt: when.getTime(), expiresAt: soon.expires_at }),
    ]);
  });

  it('is cancelled with the bookmark', async () => {
    const soon = job('1', {}, 5 * DAY);
    savedJobs = [soon];
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/saved' });
    fireEvent.press(await screen.findByRole('button', { name: ar.app.saved.remind.setSpoken }));
    await waitFor(() => expect(phone.__scheduled.size).toBe(1));

    fireEvent.press(screen.getByRole('button', { name: ar.jobs.removeSaved }));
    await waitFor(() => expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('reminder-1'));
    expect(phone.__scheduled.size).toBe(0);
    await waitFor(async () => expect(await kept(`bc.saved-reminders.v1:${USER_ID}`)).toEqual([]));
  });

  it('comes back with the bookmark when its removal is undone', async () => {
    const soon = job('1', {}, 5 * DAY);
    savedJobs = [soon];
    // The website puts the bookmark back as it took it off.
    server.on('POST /api/mobile/v1/actions/toggleSavedJob', (_url, init) => {
      const { input } = JSON.parse(String(init?.body));
      const had = savedJobs.some((item) => item.id === input.jobId);
      savedJobs = had ? savedJobs.filter((item) => item.id !== input.jobId) : [...savedJobs, soon];
      return { ok: true, data: { saved: !had } };
    });
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/saved' });
    fireEvent.press(await screen.findByRole('button', { name: ar.app.saved.remind.setSpoken }));
    await waitFor(() => expect(phone.__scheduled.size).toBe(1));

    fireEvent.press(screen.getByRole('button', { name: ar.jobs.removeSaved }));
    await waitFor(() => expect(phone.__scheduled.size).toBe(0));
    await waitFor(() => expect(shownToast()?.action?.label).toBe(ar.app.toast.undo));
    await act(async () => shownToast()?.action?.onPress());

    // Scheduled again, for the same moment, and kept for this person: the card says it is set.
    await waitFor(() => expect(phone.__scheduled.size).toBe(1));
    const [again] = [...phone.__scheduled.values()];
    expect(again.trigger).toEqual({ type: 'date', date: reminderAt(soon.expires_at)?.getTime() });
    await waitFor(async () => expect(await kept(`bc.saved-reminders.v1:${USER_ID}`)).toEqual([expect.objectContaining({ id: soon.id, notificationId: again.identifier })]));
    const said = tAr('app.saved.remind.when', { when: formatDateTime(reminderAt(soon.expires_at) as Date, 'ar') });
    expect(await screen.findByRole('button', { name: said })).toBeTruthy();
  });

  it('follows the saved list without the Saved tab being opened: a listing closed early takes its reminder with it', async () => {
    const soon = job('1', {}, 5 * DAY);
    await setReminder(USER_ID, soon, words);
    expect(phone.__scheduled.size).toBe(1);
    // Closed by the company since; the reader only ever opens the board.
    savedJobs = [{ ...soon, status: 'closed' }];
    await signedIn();
    renderRouter(app, { initialUrl: '/jobs' });

    await waitFor(() => expect(phone.__scheduled.size).toBe(0));
    expect(await jobReminders.read(USER_ID)).toEqual([]);
  });

  it('takes back the reminder of a listing applied to since, wherever the application was sent from', async () => {
    const soon = job('1', {}, 5 * DAY);
    await setReminder(USER_ID, soon, words);
    savedJobs = [soon];
    // Applied on the website: the list still holds it, and it is still open.
    server.on('GET /rest/v1/applications', [
      { id: 'application-1', job_id: soon.id, status: 'submitted', created_at: '2026-10-01T10:00:00Z', job: { ...soon } },
    ]);
    await signedIn();
    renderRouter(app, { initialUrl: '/jobs' });

    await waitFor(() => expect(phone.__scheduled.size).toBe(0));
    expect(await jobReminders.read(USER_ID)).toEqual([]);
  });

  it('takes back the reminder of a listing hidden, and puts it back when the listing is', async () => {
    const soon = job('1', {}, 5 * DAY);
    await setReminder(USER_ID, soon, words);
    savedJobs = [soon];
    await signedIn();
    renderRouter(app, { initialUrl: '/jobs' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    expect(phone.__scheduled.size).toBe(1);

    act(() => hideJob(soon.id, { name: soon.title_ar, slug: soon.slug }));
    await waitFor(() => expect(phone.__scheduled.size).toBe(0));
    expect(await jobReminders.read(USER_ID)).toEqual([]);

    act(() => unhideJob(soon.id));
    await waitFor(() => expect(phone.__scheduled.size).toBe(1));
    expect(await jobReminders.read(USER_ID)).toEqual([expect.objectContaining({ id: soon.id, fireAt: reminderAt(soon.expires_at)?.getTime() })]);
  });

  it("opens a tapped reminder's listing once the board's filters have closed, not under them", async () => {
    await signedIn();
    const result = renderRouter(app, { initialUrl: '/jobs' });
    fireEvent.press(await screen.findByRole('button', { name: ar.jobs.filters }));
    const filters = () => screen.UNSAFE_getAllByType(Modal).find((modal) => modal.props.presentationStyle === 'pageSheet');
    await waitFor(() => expect(filters()?.props.visible).toBe(true));

    // The notification tapped: its page waits for the sheet.
    act(() => openWhenReady(`/jobs/${listing.slug}`));
    await waitFor(() => expect(filters()?.props.visible).toBe(false));
    expect(result.getPathname()).toBe('/jobs');
    act(() => filters()?.props.onDismiss());
    await waitFor(() => expect(result.getPathname()).toBe(`/jobs/${listing.slug}`));
  });

  it('reads nothing for the reminders when there are none to keep in step', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: '/jobs' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    await act(async () => {});
    expect(server.asked('/rest/v1/saved_jobs').filter((request) => request.url.searchParams.get('select') !== 'job_id')).toEqual([]);
  });

  it('is taken back from the card, with Undo', async () => {
    const soon = job('1', {}, 5 * DAY);
    savedJobs = [soon];
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/saved' });
    fireEvent.press(await screen.findByRole('button', { name: ar.app.saved.remind.setSpoken }));
    const said = tAr('app.saved.remind.when', { when: formatDateTime(reminderAt(soon.expires_at) as Date, 'ar') });
    fireEvent.press(await screen.findByRole('button', { name: said }));

    await waitFor(() => expect(shownToast()?.message).toBe(ar.app.saved.remind.cancelled));
    expect(phone.__scheduled.size).toBe(0);
    expect(await screen.findByRole('button', { name: ar.app.saved.remind.setSpoken })).toBeTruthy();
    await act(async () => shownToast()?.action?.onPress());
    await waitFor(() => expect(phone.__scheduled.size).toBe(1));
  });

  it('says where to turn notifications on when the phone says no, and schedules nothing', async () => {
    savedJobs = [job('1', {}, 5 * DAY)];
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(denied as never);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/saved' });
    fireEvent.press(await screen.findByRole('button', { name: ar.app.saved.remind.setSpoken }));

    await waitFor(() => expect(shownToast()).toMatchObject({ message: ar.app.saved.remind.denied, action: { label: ar.app.push.openSettings } }));
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    act(() => shownToast()?.action?.onPress());
    expect(openSettings).toHaveBeenCalled();
    openSettings.mockRestore();
  });

  it('marks a listing closing within three days, and offers no reminder on one closed or applied to', async () => {
    const closing = job('1', {}, 2 * DAY + 60 * 60 * 1000);
    const ended = job('2', { expires_at: new Date(Date.now() - DAY).toISOString() });
    savedJobs = [closing, ended];
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/saved' });

    const days = closingInDays(closing.expires_at) as number;
    expect(days).toBeLessThanOrEqual(3);
    expect(await screen.findByText(tAr.markup('app.saved.closing', { days, ...markupTags }))).toBeTruthy();
    // One reminder offered: the open listing's.
    expect(screen.getAllByRole('button', { name: ar.app.saved.remind.setSpoken })).toHaveLength(1);
  });

  it('is taken off the phone when its person signs out, and put back when they return', async () => {
    const soon = job('1', {}, 5 * DAY);
    expect((await setReminder('person-a', soon, words)).status).toBe('set');
    expect(phone.__scheduled.size).toBe(1);

    await syncReminders('anon');
    expect(phone.__scheduled.size).toBe(0);
    // Still theirs, listed under their name.
    expect(await jobReminders.read('person-a')).toHaveLength(1);

    await syncReminders('person-a');
    expect(phone.__scheduled.size).toBe(1);
    const [again] = await jobReminders.read('person-a');
    expect(phone.__scheduled.has(again.notificationId)).toBe(true);
    expect(again.fireAt).toBe(reminderAt(soon.expires_at)?.getTime());
  });

  it('lets one that has gone off go, and never asks the phone while putting them back', async () => {
    const soon = job('1', {}, 5 * DAY);
    await setReminder('person-a', soon, words, new Date());
    await syncReminders('anon');
    jest.mocked(Notifications.requestPermissionsAsync).mockClear();

    // A week later, the reminder's time has passed.
    await syncReminders('person-a', new Date(Date.now() + 7 * DAY));
    expect(await jobReminders.read('person-a')).toEqual([]);
    expect(phone.__scheduled.size).toBe(0);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('follows the saved list: gone when the listing was unsaved elsewhere, moved when its closing date moved', async () => {
    const one = job('1', {}, 5 * DAY);
    const two = job('2', {}, 6 * DAY);
    await setReminder('person-a', one, words);
    await setReminder('person-a', two, words);
    const set = Date.now();

    // Read after both were set: the first is no longer saved, the second closes a week later.
    const later = { ...two, expires_at: new Date(Date.now() + 13 * DAY).toISOString() };
    await reconcileReminders('person-a', [later], set + 1, () => words);
    const left = await jobReminders.read('person-a');
    expect(left.map((reminder) => reminder.id)).toEqual([two.id]);
    expect(left[0].fireAt).toBe(reminderAt(later.expires_at)?.getTime());
    expect(phone.__scheduled.size).toBe(1);
    expect(phone.__scheduled.has(left[0].notificationId)).toBe(true);
  });

  it('is not taken for unsaved by a read of the list from before it was set', async () => {
    const one = job('1', {}, 5 * DAY);
    await setReminder('person-a', one, words);
    await reconcileReminders('person-a', [], Date.now() - 60_000, () => words);
    expect(await jobReminders.read('person-a')).toHaveLength(1);
  });

  it('opens its listing when tapped, through the pushes’ own way in', async () => {
    savedJobs = [listing];
    await signedIn();
    const result = renderRouter(app, { initialUrl: '/dashboard/saved' });
    await screen.findByText(listing.title_ar);
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());
    const listener = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock.calls.at(-1)?.[0];

    act(() =>
      listener?.({
        actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
        notification: { request: { content: { data: { localHref: `/jobs/${listing.slug}`, reminderFor: listing.id } } } },
      } as never),
    );
    await waitFor(() => expect(result.getPathname()).toBe(`/jobs/${listing.slug}`));
  });

  it('leads only to a listing or the directory', () => {
    const tapped = (localHref: unknown) =>
      localHrefOf({ actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER, notification: { request: { content: { data: { localHref } } } } } as never);
    expect(tapped('/jobs/sales-consultant-a1b2')).toBe('/jobs/sales-consultant-a1b2');
    expect(tapped('/agents?track=resale')).toBe('/agents?track=resale');
    expect(tapped('/jobs/a/apply')).toBeNull();
    expect(tapped('https://example.com/jobs/x')).toBeNull();
    expect(tapped('/account/delete')).toBeNull();
    expect(tapped(42)).toBeNull();
  });
});

/* ------------------------------------------------------------------------- */

describe('a private note on a saved listing', () => {
  it('is kept per person, trimmed, cut at the limit, and gone when emptied', async () => {
    keepNote('person-a', 'job-1', '  كلمت منى  ');
    expect(await jobNotes.read('person-a')).toEqual([expect.objectContaining({ id: 'job-1', text: 'كلمت منى' })]);
    expect(await jobNotes.read('person-b')).toEqual([]);

    keepNote('person-a', 'job-1', 'x'.repeat(NOTE_MAX + 50));
    expect((await jobNotes.read('person-a'))[0].text).toHaveLength(NOTE_MAX);

    keepNote('person-a', 'job-1', '   ');
    expect(await jobNotes.read('person-a')).toEqual([]);
  });

  it('is written, changed and deleted from the saved card, and shown under it', async () => {
    const one = job('1');
    savedJobs = [one];
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/saved' });

    // Written.
    fireEvent.press(await screen.findByRole('button', { name: ar.app.saved.notes.add }));
    fireEvent.changeText(await screen.findByLabelText(ar.app.saved.notes.title), '  المقابلة يوم الحد  ');
    fireEvent.press(screen.getByRole('button', { name: ar.common.save }));
    await waitFor(() => expect(shownToast()?.message).toBe(ar.app.saved.notes.saved));
    const shown = `${ar.app.saved.notes.prefix} المقابلة يوم الحد`;
    expect(await screen.findByRole('button', { name: shown })).toBeTruthy();
    expect(await kept(`bc.saved-notes.v1:${USER_ID}`)).toEqual([expect.objectContaining({ id: one.id, text: 'المقابلة يوم الحد' })]);

    // Changed: the sheet opens on the note as it is.
    await sheetClosed();
    fireEvent.press(screen.getByRole('button', { name: shown }));
    const field = await screen.findByLabelText(ar.app.saved.notes.title);
    expect(field.props.value).toBe('المقابلة يوم الحد');
    fireEvent.changeText(field, 'المقابلة اتأجلت');
    fireEvent.press(screen.getByRole('button', { name: ar.common.save }));
    const changed = `${ar.app.saved.notes.prefix} المقابلة اتأجلت`;
    expect(await screen.findByRole('button', { name: changed })).toBeTruthy();

    // Deleted, with Undo.
    await sheetClosed();
    fireEvent.press(screen.getByRole('button', { name: changed }));
    fireEvent.press(await screen.findByRole('button', { name: ar.app.saved.notes.delete }));
    await waitFor(() => expect(shownToast()).toMatchObject({ message: ar.app.saved.notes.deleted, action: { label: ar.app.toast.undo } }));
    expect(await screen.findByRole('button', { name: ar.app.saved.notes.add })).toBeTruthy();
    await waitFor(async () => expect(await kept(`bc.saved-notes.v1:${USER_ID}`)).toEqual([]));
    act(() => shownToast()?.action?.onPress());
    expect(await screen.findByRole('button', { name: changed })).toBeTruthy();
  });

  it('focuses the field once the sheet is up, not as it mounts', async () => {
    savedJobs = [job('1')];
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/saved' });
    fireEvent.press(await screen.findByRole('button', { name: ar.app.saved.notes.add }));
    const field = await screen.findByLabelText(ar.app.saved.notes.title);
    // autoFocus raised the keyboard while iOS was still presenting the sheet.
    expect(field.props.autoFocus).toBeFalsy();
    const modal = screen.UNSAFE_getAllByType(Modal).find((node) => node.props.visible && node.props.onShow);
    expect(modal).toBeTruthy();
  });

  it('stands the sheet above the keyboard, by the keyboard’s own height', async () => {
    savedJobs = [job('1')];
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/saved' });
    fireEvent.press(await screen.findByRole('button', { name: ar.app.saved.notes.add }));
    await screen.findByLabelText(ar.app.saved.notes.title);
    const room = () => StyleSheet.flatten(screen.getByTestId('note-sheet-room').props.style);
    expect(room().paddingBottom).toBe(0);
    const keyboard = { duration: 250, easing: 'keyboard', endCoordinates: { height: 336, screenX: 0, screenY: 508, width: 390 } };
    act(() => DeviceEventEmitter.emit('keyboardWillShow', keyboard));
    expect(room().paddingBottom).toBe(336);
    act(() => DeviceEventEmitter.emit('keyboardWillHide', { ...keyboard, endCoordinates: { ...keyboard.endCoordinates, screenY: 844 } }));
    expect(room().paddingBottom).toBe(0);
  });

  it('keeps Save quiet until something changed', async () => {
    savedJobs = [job('1')];
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/saved' });
    fireEvent.press(await screen.findByRole('button', { name: ar.app.saved.notes.add }));
    await screen.findByLabelText(ar.app.saved.notes.title);
    expect(screen.getByRole('button', { name: ar.common.save }).props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.changeText(screen.getByLabelText(ar.app.saved.notes.title), '   ');
    expect(screen.getByRole('button', { name: ar.common.save }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('belongs to the person who wrote it, not the next one on the phone', async () => {
    const one = job('1');
    savedJobs = [one];
    keepNote('somebody-else', one.id, 'ليست لك');
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/saved' });
    expect(await screen.findByRole('button', { name: ar.app.saved.notes.add })).toBeTruthy();
    expect(screen.queryByText('ليست لك')).toBeNull();
  });

  it('is on the listing page while the listing is saved', async () => {
    savedJobs = [listing];
    await signedIn();
    keepNote(USER_ID, listing.id, 'اسأل عن العمولة');
    renderRouter(app, { initialUrl: `/jobs/${listing.slug}` });
    expect(await screen.findByRole('button', { name: `${ar.app.saved.notes.prefix} اسأل عن العمولة` })).toBeTruthy();
  });

  it('is not offered on a listing that is not saved', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: `/jobs/${listing.slug}` });
    expect(await screen.findByRole('button', { name: ar.jobs.save })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: ar.jobs.save }).props.accessibilityState?.busy).toBeFalsy());
    expect(screen.queryByRole('button', { name: ar.app.saved.notes.forListing })).toBeNull();
  });
});

/* ------------------------------------------------------------------------- */

describe('choosing listings to compare', () => {
  it('takes two or three, in the order chosen', () => {
    let picked: string[] = [];
    for (const id of ['b', 'a', 'c']) picked = togglePick(picked, id).picked;
    expect(picked).toEqual(['b', 'a', 'c']);
    expect(togglePick(picked, 'd')).toEqual({ picked: ['b', 'a', 'c'], refused: true });
    expect(togglePick(picked, 'a')).toEqual({ picked: ['b', 'c'], refused: false });
    expect(parseCompareIds('b,a,,b,c,d')).toEqual(['b', 'a', 'c']);
  });

  it('marks the best of a row only where one is better', () => {
    const rich = job('1', { basic_salary_min: 10000, basic_salary_max: 20000, leads_source: 'self_generated' });
    const floor = job('2', { basic_salary_min: 12000, basic_salary_max: null, leads_source: 'company_provided' });
    const commissionOnly = job('3', { basic_salary_min: null, basic_salary_max: null, leads_source: 'hybrid' });
    const best = bestOf([rich, floor, commissionOnly]);
    expect([...best.salary]).toEqual([rich.id]);
    expect([...best.leads]).toEqual([floor.id]);
    // The same commission and seats everywhere: nothing better to mark.
    expect(best.commission.size).toBe(0);
    expect(best.seats.size).toBe(0);
    // Two alike at the top are both best; all alike, none.
    expect([...bestOf([rich, { ...floor, basic_salary_max: 20000 }, commissionOnly]).salary]).toEqual([rich.id, floor.id]);
    expect(bestOf([rich, { ...floor, basic_salary_max: 20000 }]).salary.size).toBe(0);
    // Equal percentages beside a commission that is not a percentage: neither beats what cannot be compared.
    const threePct = { commission_type: 'percentage' as const, commission_value: 3 };
    const split = job('5', { commission_type: 'split', commission_value: null });
    expect(bestOf([job('6', threePct), job('7', threePct), split]).commission.size).toBe(0);
    expect([...bestOf([job('6', threePct), job('7', { ...threePct, commission_value: 2 }), split]).commission]).toEqual([job('6').id]);
  });

  const a = job('1', { title_ar: 'استشاري أ', basic_salary_min: 10000, basic_salary_max: 15000, leads_source: 'company_provided' });
  const b = job('2', { title_ar: 'استشاري ب', basic_salary_min: 12000, basic_salary_max: 20000, leads_source: 'self_generated' });
  const c = job('3', { title_ar: 'استشاري ج', basic_salary_min: 8000, basic_salary_max: null, leads_source: 'hybrid' });
  const d = job('4', { title_ar: 'استشاري د', basic_salary_min: null, basic_salary_max: null });
  const pickOf = (item: JobListItem) => formatList([item.title_ar, item.company.name_ar], 'ar');

  it('picks up to three on Saved, says why not a fourth, and opens them side by side', async () => {
    savedJobs = [a, b, c, d];
    await signedIn();
    const result = renderRouter(app, { initialUrl: '/dashboard/saved' });

    fireEvent.press(await screen.findByRole('button', { name: ar.app.saved.compare.start }));
    expect(await screen.findAllByRole('checkbox')).toHaveLength(4);
    const go = () => screen.getByTestId('compare-go');
    expect(go().props.accessibilityState).toMatchObject({ disabled: true });

    for (const item of [b, a]) fireEvent.press(screen.getByRole('checkbox', { name: pickOf(item) }));
    await waitFor(() => expect(go().props.accessibilityState).toMatchObject({ disabled: false }));
    fireEvent.press(screen.getByRole('checkbox', { name: pickOf(c) }));
    expect(screen.getByRole('checkbox', { name: pickOf(c) }).props.accessibilityState).toMatchObject({ checked: true });

    // A fourth: refused, and said why.
    fireEvent.press(screen.getByRole('checkbox', { name: pickOf(d) }));
    expect(shownToast()?.message).toBe(tAr.markup('app.saved.compare.limit', { max: 3, ...markupTags }));
    expect(screen.getByRole('checkbox', { name: pickOf(d) }).props.accessibilityState).toMatchObject({ checked: false, disabled: true });
    expect(screen.getByText(tAr.markup('app.saved.compare.go', { count: 3, ...markupTags }))).toBeTruthy();

    fireEvent.press(go());
    await waitFor(() => expect(result.getPathname()).toBe('/dashboard/saved/compare'));
    expect(result.getSearchParams()).toEqual({ ids: [b.id, a.id, c.id].join(',') });

    // A row for each fact, a column for each listing, in the order chosen.
    for (const label of [
      ar.filters.district,
      ar.app.saved.compare.salary,
      ar.compensation.commission,
      ar.compensation.leadsSource,
      ar.filters.track,
      ar.jobForm.experienceBand,
      ar.jobForm.seats,
      ar.filters.posted,
    ]) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
    expect(screen.getAllByText(/^استشاري [أبجد]$/).map((node) => node.props.children)).toEqual([b.title_ar, a.title_ar, c.title_ar]);
    expect(screen.getAllByText(ar.leadsSource.self_generated)).toHaveLength(1);

    // The best of a row, said in words: the highest salary (b), the company bringing the clients (a).
    const best = screen.getAllByLabelText(new RegExp(`\\. ${ar.app.saved.compare.best}$`));
    expect(best.map((cell) => String(cell.props.accessibilityLabel).split('. ')[0])).toEqual([b.title_ar, a.title_ar]);

    // And each listing a tap away.
    const links = screen.getAllByRole('link', { name: new RegExp(`^${ar.app.jobMenu.open}\\. `) });
    expect(links).toHaveLength(3);
    fireEvent.press(links[1]);
    await waitFor(() => expect(result.getPathname()).toBe(`/jobs/${a.slug}`));
  });

  it('offers no comparing with fewer than two open, and leaves the ended ones out of it', async () => {
    savedJobs = [a, { ...b, expires_at: new Date(Date.now() - DAY).toISOString() }];
    await signedIn();
    renderRouter(app, { initialUrl: '/dashboard/saved' });
    expect(await screen.findByText(a.title_ar)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.app.saved.compare.start })).toBeNull();
  });

  it('leaves out one chosen that has closed since, as Saved does', async () => {
    savedJobs = [a, b, { ...c, status: 'closed' }];
    await signedIn();
    renderRouter(app, { initialUrl: `/dashboard/saved/compare?ids=${a.id},${b.id},${c.id}` });
    expect(await screen.findByText(a.title_ar)).toBeTruthy();
    expect(screen.getByText(b.title_ar)).toBeTruthy();
    expect(screen.queryByText(c.title_ar)).toBeNull();
    expect(screen.getAllByRole('link', { name: new RegExp(`^${ar.app.jobMenu.open}\\. `) })).toHaveLength(2);
  });

  it('says there is nothing to compare when only one chosen is still hiring', async () => {
    savedJobs = [a, { ...b, expires_at: new Date(Date.now() - DAY).toISOString() }];
    await signedIn();
    renderRouter(app, { initialUrl: `/dashboard/saved/compare?ids=${a.id},${b.id}` });
    expect(await screen.findByText(ar.app.saved.compare.tooFew)).toBeTruthy();
  });

  it('says so when fewer than two of those chosen are still saved', async () => {
    savedJobs = [a];
    await signedIn();
    renderRouter(app, { initialUrl: `/dashboard/saved/compare?ids=${a.id},${b.id}` });
    expect(await screen.findByText(ar.app.saved.compare.tooFew)).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.app.saved.compare.back })).toBeTruthy();
  });
});
