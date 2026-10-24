import type { ReactNode } from 'react';
import { Animated, ScrollView, StyleSheet, Text } from 'react-native';
import { router, Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { useTabList } from '~/features/tab-bar';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import { useReduceMotion } from '~/theme/reduce-motion';
import TabsLayout from '../src/app/(tabs)/_layout';
import * as SharedLayout from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)/_layout';
import { mobileConfig } from './auth-fixtures';
import { fakeServer } from './server';

/*
  The tab bar, the app's own: every tab the reader has, each an icon over its
  name. It keeps its size and its names however a list scrolls, as Apple asks
  of a tab bar ("Include tab labels"). Pressing the open tab again goes back
  to its first screen, then to the top of that screen's list.
*/

jest.mock('~/lib/session-storage', () => ({
  encryptedSessionStorage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
jest.mock('~/theme/reduce-motion', () => ({ useReduceMotion: jest.fn(() => false) }));

const ar = catalogues.ar;
const server = fakeServer();
const SHARED = '(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)';
let client: QueryClient;
let timing: jest.SpyInstance;

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/logout', {});
  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  jest.mocked(useReduceMotion).mockReturnValue(false);
  timing = jest.spyOn(Animated, 'timing');
});

afterEach(() => timing.mockRestore());

function Settled({ children }: { children: ReactNode }) {
  return useSession().settled ? children : null;
}

function Root() {
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

/** A tab's first screen: a long list. */
const list = (name: string) =>
  function TabList() {
    return (
      <ScrollView testID={name} {...useTabList()}>
        <Text>{name}</Text>
      </ScrollView>
    );
  };

/** A screen opened inside a tab: a long page. */
function Listing() {
  return (
    <ScrollView testID="listing">
      <Text>listing</Text>
    </ScrollView>
  );
}

const app = {
  _layout: { default: Root, unstable_settings: { anchor: '(tabs)' } },
  '(tabs)/_layout': TabsLayout,
  [`${SHARED}/_layout`]: SharedLayout,
  '(tabs)/(home)/index': list('home'),
  '(tabs)/(jobs)/jobs/index': list('board'),
  [`${SHARED}/companies/index`]: list('companies'),
  [`${SHARED}/jobs/[slug]`]: Listing,
  '(tabs)/(account)/account/index': list('account'),
};

/** The list scrolled to `y`, as iOS reports it: a long list, a phone's height of it in view. */
function scrollTo(testID: string, y: number) {
  fireEvent.scroll(screen.getByTestId(testID), {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 390, height: 4000 },
      layoutMeasurement: { width: 390, height: 700 },
    },
  });
}

function scrollThrough(testID: string, ...offsets: number[]) {
  for (const y of offsets) scrollTo(testID, y);
}

async function launch() {
  await renderRouter(app, { initialUrl: '/' });
  expect(await screen.findByText('home')).toBeTruthy();
}

const names = () => screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel as string);

it("has every one of the reader's tabs, named, in reading order, the open one selected", async () => {
  await launch();
  // Signed out: the public site and the door (src/lib/tabs.ts). In Arabic the
  // first is laid out at the right, as every row of the app is.
  expect(names()).toEqual([ar.app.tabs.home, ar.nav.jobs, ar.app.tabs.companies, ar.app.tabs.account]);
  // One list of tabs to VoiceOver, its tabs read one by one.
  expect(screen.getByTestId('tab-bar').props.accessibilityRole).toBe('tablist');
  const selected = screen.getAllByRole('tab').filter((tab) => tab.props.accessibilityState?.selected);
  expect(selected.map((tab) => tab.props.accessibilityLabel)).toEqual([ar.app.tabs.home]);

  fireEvent.press(screen.getByRole('tab', { name: ar.nav.jobs }));
  expect(await screen.findByText('board')).toBeTruthy();
  expect(screen.getByRole('tab', { name: ar.nav.jobs }).props.accessibilityState).toEqual({ selected: true });
});

it('stays whole, every tab named, however a list scrolls', async () => {
  await launch();
  const every = [ar.app.tabs.home, ar.nav.jobs, ar.app.tabs.companies, ar.app.tabs.account];
  scrollThrough('home', 0, 30, 120, 260, 1600, 3300);
  // Nothing asked of the native thread to make it smaller, and nothing drawn so.
  expect(timing).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: 260 }));
  const bar = StyleSheet.flatten(screen.getByTestId('tab-bar').props.style) as { transform?: unknown };
  expect(bar.transform).toBeUndefined();
  expect(names()).toEqual(every);
  // Each name is drawn, at full strength, not only read to VoiceOver.
  for (const name of every) expect(screen.getByText(name)).toBeTruthy();
  scrollThrough('home', 1200, 10);
  expect(names()).toEqual(every);
});

it('pressed again, takes its tab back to the first screen, then that screen back to its top', async () => {
  const scrolled = jest.spyOn(ScrollView.prototype as unknown as { scrollTo: (options: object) => void }, 'scrollTo');
  try {
    await launch();
    act(() => router.push('/jobs/broker-a1b2'));
    expect(await screen.findByText('listing')).toBeTruthy();

    fireEvent.press(screen.getByRole('tab', { name: ar.app.tabs.home }));
    await waitFor(() => expect(screen.queryByText('listing')).toBeNull());
    expect(scrolled).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('tab', { name: ar.app.tabs.home }));
    await waitFor(() => expect(scrolled).toHaveBeenCalledWith({ y: 0, animated: true }));
  } finally {
    scrolled.mockRestore();
  }
});
