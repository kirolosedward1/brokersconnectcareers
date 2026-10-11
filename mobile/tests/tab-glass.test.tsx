import type { ReactNode } from 'react';
import { Animated, ScrollView, StyleSheet, Text } from 'react-native';
import { Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { resetTabBarForTests, useTabList } from '~/features/tab-bar';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { haptic } from '~/lib/haptics';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import { useReduceMotion } from '~/theme/reduce-motion';
import { useReduceTransparency } from '~/theme/reduce-transparency';
import TabsLayout from '../src/app/(tabs)/_layout';
import * as SharedLayout from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
import { mobileConfig } from './auth-fixtures';
import { fakeServer } from './server';

/*
  The tab bar's glass and its pill. On a phone that draws Liquid Glass the bar
  is glass (a solid capsule with Reduce Transparency on). The open tab sits on
  one pill that glides to each tab opened next; a finger drawn along the bar
  takes the pill with it as a lens, ticking at each tab, and letting go opens
  the tab under it.

  The tabs' places are what iOS lays out — given here as it would, right to
  left: Home at the right. The pill moves on the native thread; a test sees
  what it was asked to do (Animated.spring's settings) and where it starts.
*/

jest.mock('expo-glass-effect', () => {
  const { View } = jest.requireActual('react-native');
  return { GlassView: View, isLiquidGlassAvailable: () => true, isGlassEffectAPIAvailable: () => true };
});
jest.mock('~/lib/session-storage', () => ({
  encryptedSessionStorage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
jest.mock('~/theme/reduce-motion', () => ({ useReduceMotion: jest.fn(() => false) }));
jest.mock('~/theme/reduce-transparency', () => ({ useReduceTransparency: jest.fn(() => false) }));

const ar = catalogues.ar;
const server = fakeServer();
const SHARED = '(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)';
let client: QueryClient;
let spring: jest.SpyInstance;
let tick: jest.SpyInstance;

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/logout', {});
  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  resetTabBarForTests();
  jest.mocked(useReduceMotion).mockReturnValue(false);
  jest.mocked(useReduceTransparency).mockReturnValue(false);
  spring = jest.spyOn(Animated, 'spring');
  tick = jest.spyOn(haptic, 'selection').mockImplementation(() => {});
});

afterEach(() => {
  spring.mockRestore();
  tick.mockRestore();
});

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

const list = (name: string) =>
  function TabList() {
    return (
      <ScrollView testID={name} {...useTabList()}>
        <Text>{name}</Text>
      </ScrollView>
    );
  };

const app = {
  _layout: { default: Root, unstable_settings: { anchor: '(tabs)' } },
  '(tabs)/_layout': TabsLayout,
  [`${SHARED}/_layout`]: SharedLayout,
  '(tabs)/(home)/index': list('home'),
  '(tabs)/(jobs)/jobs/index': list('board'),
  [`${SHARED}/companies/index`]: list('companies'),
  '(tabs)/(account)/account/index': list('account'),
};

/** The bar, 350 points wide 20 in from the screen's edge, and its four tabs as iOS lays them out right to left. */
const BAR = { x: 20, width: 350 };
const TAB_WIDTH = 86;
const PLACES: Record<string, number> = { home: 261, jobs: 175, companies: 89, account: 3 };
const tabNames: Record<string, string> = {
  home: ar.app.tabs.home,
  jobs: ar.nav.jobs,
  companies: ar.app.tabs.companies,
  account: ar.app.tabs.account,
};

function layout(target: Parameters<typeof fireEvent>[0], x: number, width: number) {
  fireEvent(target, 'layout', { nativeEvent: { layout: { x, y: 0, width, height: 56 } } });
}

/**
 * Hands the bar a responder event, as iOS's responder system does once the
 * bar has taken the touch. (Called on the bar itself: the testing library
 * passes nothing to a view that answers no to being pressed, which the bar
 * does — a press is its tabs'.)
 */
function toBar(event: 'onLayout' | 'onResponderGrant' | 'onResponderMove' | 'onResponderRelease' | 'onResponderTerminate', payload: object) {
  const handler = screen.getByTestId('tab-bar').props[event] as (payload: object) => void;
  act(() => handler(payload));
}

async function launch() {
  renderRouter(app, { initialUrl: '/' });
  expect(await screen.findByText('home')).toBeTruthy();
  toBar('onLayout', { nativeEvent: { layout: { x: BAR.x, y: 0, width: BAR.width, height: 56 } } });
  for (const [tab, x] of Object.entries(PLACES)) layout(screen.getByRole('tab', { name: tabNames[tab] }), x, TAB_WIDTH);
  await act(async () => {});
}

type Drawn = { width?: number; transform?: Record<string, unknown>[] };
const pill = () => StyleSheet.flatten(screen.getByTestId('tab-pill').props.style) as Drawn;
const valueOf = (value: unknown) => (typeof value === 'number' ? value : (value as { __getValue(): number }).__getValue());
/** Where the pill is now: read from its animated value, which moves on the native thread past what the view was drawn with. */
const pillAt = () => {
  const style = StyleSheet.flatten(screen.UNSAFE_getAllByProps({ testID: 'tab-pill' })[0].props.style) as Drawn;
  return valueOf(style.transform?.find((move) => 'translateX' in move)?.translateX);
};
/** The pill's last glide, as asked of the native thread. */
const lastGlide = () => spring.mock.calls.filter(([, config]) => typeof config.toValue === 'number' && config.toValue > 1).at(-1)?.[1];

/** A touch at screen point `pageX`, as the responder system hands it over: one finger, put down at `from`. */
function touchAt(from: number, pageX: number, time: number) {
  return {
    nativeEvent: { touches: [{ pageX, pageY: 800 }], changedTouches: [{ pageX, pageY: 800 }], pageX, pageY: 800, timestamp: time },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: time,
      touchBank: [
        {
          touchActive: true,
          startPageX: from,
          startPageY: 800,
          startTimeStamp: 0,
          currentPageX: pageX,
          currentPageY: 800,
          currentTimeStamp: time,
          previousPageX: from,
          previousPageY: 800,
          previousTimeStamp: 0,
        },
      ],
    },
  };
}

/** A finger on the bar drawn through the screen points `path`, a few moves between each, then let go (or taken away). */
function drawThrough(path: number[], end: 'release' | 'terminate' = 'release') {
  const from = path[0];
  let time = 1;
  toBar('onResponderGrant', touchAt(from, from, time));
  for (let leg = 1; leg < path.length; leg++) {
    for (let step = 1; step <= 4; step++) {
      time += 10;
      toBar('onResponderMove', touchAt(from, path[leg - 1] + ((path[leg] - path[leg - 1]) * step) / 4, time));
    }
  }
  toBar(end === 'release' ? 'onResponderRelease' : 'onResponderTerminate', touchAt(from, path.at(-1) ?? from, time + 10));
}

/** The middle of a tab, as a point on the screen. */
const middleOf = (tab: string) => BAR.x + PLACES[tab] + TAB_WIDTH / 2;

it('is glass on a phone that draws it, and a solid capsule with Reduce Transparency on', async () => {
  await launch();
  expect(screen.getByTestId('tab-bar-glass')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('tab-bar').props.style).backgroundColor).toBe('transparent');
  screen.unmount();

  jest.mocked(useReduceTransparency).mockReturnValue(true);
  await launch();
  expect(screen.queryByTestId('tab-bar-glass')).toBeNull();
  expect(StyleSheet.flatten(screen.getByTestId('tab-bar').props.style).backgroundColor).not.toBe('transparent');
});

it('marks the open tab with one pill, the width of a tab, which glides to the tab opened next', async () => {
  await launch();
  // One pill, over Home, from the first frame: not slid in from anywhere.
  expect(screen.getAllByTestId('tab-pill')).toHaveLength(1);
  expect(pill().width).toBe(TAB_WIDTH);
  expect(pillAt()).toBe(PLACES.home);
  expect(lastGlide()).toBeUndefined();

  fireEvent.press(screen.getByRole('tab', { name: ar.nav.jobs }));
  expect(await screen.findByText('board')).toBeTruthy();
  expect(lastGlide()).toEqual(expect.objectContaining({ toValue: PLACES.jobs, useNativeDriver: true }));
});

it('goes straight to the tab opened with Reduce Motion on', async () => {
  jest.mocked(useReduceMotion).mockReturnValue(true);
  await launch();
  fireEvent.press(screen.getByRole('tab', { name: ar.app.tabs.account }));
  expect(await screen.findByText('account')).toBeTruthy();
  expect(lastGlide()).toBeUndefined();
  expect(pillAt()).toBe(PLACES.account);
});

it('follows a finger drawn along the bar, ticking at each tab it crosses, and opens the one it is let go over', async () => {
  await launch();
  drawThrough([middleOf('home'), middleOf('companies')]);
  // Home → Jobs → Companies: a tick at each tab after the first.
  expect(tick).toHaveBeenCalledTimes(2);
  expect(await screen.findByText('companies')).toBeTruthy();
  expect(screen.getByRole('tab', { name: ar.app.tabs.companies }).props.accessibilityState).toEqual({ selected: true });
  // The lens swelled under the finger and went back to a pill.
  const swells = spring.mock.calls.map(([, config]) => config.toValue).filter((to) => to === 0 || to === 1);
  expect(swells).toContain(1);
  expect(swells.at(-1)).toBe(0);
});

it('stays on the open tab when let go over it, or taken off the bar, the pill settling back', async () => {
  await launch();
  drawThrough([middleOf('home'), middleOf('jobs'), middleOf('home')]);
  await act(async () => {});
  expect(tick).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('tab', { name: ar.app.tabs.home }).props.accessibilityState).toEqual({ selected: true });
  expect(lastGlide()).toEqual(expect.objectContaining({ toValue: PLACES.home }));

  spring.mockClear();
  drawThrough([middleOf('home'), middleOf('account')], 'terminate');
  await act(async () => {});
  expect(screen.getByRole('tab', { name: ar.app.tabs.home }).props.accessibilityState).toEqual({ selected: true });
  expect(lastGlide()).toEqual(expect.objectContaining({ toValue: PLACES.home }));
});

it('keeps the pill inside the bar when the finger runs past its ends', async () => {
  await launch();
  const from = middleOf('home');
  toBar('onResponderGrant', touchAt(from, from, 1));
  toBar('onResponderMove', touchAt(from, BAR.x + BAR.width + 60, 20));
  expect(pillAt()).toBe(BAR.width - 3 - TAB_WIDTH);
  toBar('onResponderMove', touchAt(from, 0, 40));
  expect(pillAt()).toBe(3);
  toBar('onResponderTerminate', touchAt(from, 0, 50));
});
