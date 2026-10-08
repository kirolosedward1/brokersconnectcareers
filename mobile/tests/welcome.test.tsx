import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { catalogues } from '~/i18n/provider';
import { resetWelcomeForTests } from '~/features/welcome';
import { SESSION_KEY, supabase } from '~/lib/supabase';
import * as RootLayout from '../src/app/_layout';
import * as TabsLayout from '../src/app/(tabs)/_layout';
import * as TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
import * as WelcomeScreen from '../src/app/welcome';
import { authSession, authUser, mobileConfig, profile } from './auth-fixtures';
import { board, browse, cairo, newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  Every launch with nobody signed in opens on the welcome: the website's logo,
  what the board is, and the three ways on — create an account, sign in, or
  skip. Skipping closes it until the app is next started; a launch by a link,
  or with somebody signed in, never shows it; signing out brings it back. The
  splash screen stays up until it is drawn, so Home never flashes first.
*/

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => true),
  hideAsync: jest.fn(async () => true),
}));

const mockStored = new Map<string, string>();
// Asked once already as the Supabase client is made, at import, before the map above exists: nothing stored then.
jest.mock('~/lib/session-storage', () => ({
  encryptedSessionStorage: {
    getItem: async (key: string) => mockStored?.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockStored?.set(key, value);
    },
    removeItem: async (key: string) => {
      mockStored?.delete(key);
    },
  },
}));

const ar = catalogues.ar;
const STACK = '(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
const server = fakeServer();
const hide = jest.mocked(SplashScreen.hideAsync);

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  // Nobody signed in from the test before.
  server.on('POST /auth/v1/logout', {});
  await supabase.auth.signOut({ scope: 'local' });
  mockStored.clear();
  await AsyncStorage.clear();
  resetWelcomeForTests();
  hide.mockClear();
  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('/rest/v1/districts', [newCairo]);
  server.on('/rest/v1/governorates', [cairo]);
  server.on('/api/mobile/v1/browse', browse);
  server.on('/api/mobile/v1/jobs', board([]));
});

/** A screen over the tabs that somebody signs out from — the code, onboarding — and that then closes. */
function SignOutHere() {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.back()}>
      <Text>close-here</Text>
    </Pressable>
  );
}

async function signOut() {
  await act(async () => {
    await supabase.auth.signOut({ scope: 'local' });
  });
}

function launch(initialUrl = '/') {
  renderRouter(
    {
      _layout: RootLayout,
      '(tabs)/_layout': TabsLayout,
      [STACK]: TabStack,
      '(tabs)/(home)/index': () => <Text>home-screen</Text>,
      '(tabs)/(jobs)/jobs/index': () => <Text>board-screen</Text>,
      welcome: WelcomeScreen,
      mfa: SignOutHere,
    },
    { initialUrl },
  );
}

/** Somebody signed in on this phone, as a launch finds them. */
function signedIn() {
  const user = authUser();
  mockStored.set(SESSION_KEY, JSON.stringify(authSession(user)));
  server.on('GET /auth/v1/user', user);
  server.on('/rest/v1/profiles', [profile]);
  server.on('/rest/v1/rpc/my_company_id', () => null);
}

/** The welcome, as iOS lays it out: drawn. */
async function drawn() {
  const welcome = await screen.findByTestId('welcome');
  fireEvent(welcome, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } });
  await act(async () => {});
}

it('opens a signed-out launch on the welcome, under the splash screen until it is drawn', async () => {
  launch();
  const skip = await screen.findByRole('button', { name: ar.app.welcome.skip });
  // Skip says where it leads.
  expect(skip.props.accessibilityHint).toBe(ar.app.welcome.skipHint);
  expect(screen.getByRole('button', { name: ar.nav.signUp })).toBeTruthy();
  expect(screen.getByRole('button', { name: ar.nav.signIn })).toBeTruthy();
  // The website's logo, read as its name.
  expect(screen.getByRole('image', { name: ar.meta.siteName })).toBeTruthy();
  expect(screen.getByText(ar.landingPage.hero.title)).toBeTruthy();
  expect(hide).not.toHaveBeenCalled();

  await drawn();
  expect(hide).toHaveBeenCalled();
});

it('never scrolls, and sets the words smaller when they do not fit', async () => {
  launch();
  await drawn();
  expect(screen.UNSAFE_queryAllByType(ScrollView)).toHaveLength(0);
  const headline = () => screen.getByText(ar.landingPage.hero.title);
  const size = () => StyleSheet.flatten(headline().props.style).fontSize;
  const layout = (testID: string, height: number) =>
    fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } });

  layout('welcome-words', 400);
  layout('welcome-words-content', 300);
  await act(async () => {});
  expect(size()).toBe(32);

  // Taller than its space (the largest text sizes): a step smaller, and again until it fits.
  layout('welcome-words-content', 520);
  await act(async () => {});
  expect(size()).toBe(22);
  layout('welcome-words-content', 450);
  await act(async () => {});
  expect(size()).toBe(18);
  layout('welcome-words-content', 380);
  await act(async () => {});
  expect(size()).toBe(18);
  expect(headline().props.maxFontSizeMultiplier).toBe(1.3);
});

it('closes onto Home when the reader skips it, until the app is next started', async () => {
  launch();
  await drawn();
  fireEvent.press(await screen.findByRole('button', { name: ar.app.welcome.skip }));
  await act(async () => {});
  expect(screen.queryByTestId('welcome')).toBeNull();
  expect(screen.getByText('home-screen')).toBeTruthy();
  // Nothing about it is kept on the phone.
  expect((await AsyncStorage.getAllKeys()).filter((key) => key.includes('welcome'))).toEqual([]);

  // The next launch, still signed out, opens on it again.
  screen.unmount();
  resetWelcomeForTests();
  launch();
  expect(await screen.findByRole('button', { name: ar.app.welcome.skip })).toBeTruthy();
});

it('leaves a launch by a link where the link leads', async () => {
  launch('/jobs');
  expect(await screen.findByText('board-screen')).toBeTruthy();
  await act(async () => {});
  expect(screen.queryByTestId('welcome')).toBeNull();
});

it('never shows to somebody signed in, and opens when they sign out', async () => {
  signedIn();
  launch();
  expect(await screen.findByText('home-screen')).toBeTruthy();
  await act(async () => {});
  expect(screen.queryByTestId('welcome')).toBeNull();

  await signOut();
  fireEvent.press(await screen.findByRole('button', { name: ar.app.welcome.skip }));
  await act(async () => {});
  expect(screen.queryByTestId('welcome')).toBeNull();
  expect(screen.getByText('home-screen')).toBeTruthy();
});

it('waits for the screen somebody signed out from to close, and opens over the tabs', async () => {
  signedIn();
  launch();
  expect(await screen.findByText('home-screen')).toBeTruthy();
  await act(async () => {
    router.push('/mfa');
  });

  expect(await screen.findByText('close-here')).toBeTruthy();
  await signOut();
  // Not over the screen still closing, which its own Back would close instead.
  expect(screen.queryByTestId('welcome')).toBeNull();

  fireEvent.press(screen.getByText('close-here'));
  expect(await screen.findByRole('button', { name: ar.app.welcome.skip })).toBeTruthy();
  expect(screen.queryByText('close-here')).toBeNull();
});

it('is not opened by signing out when signing in again came first', async () => {
  const user = authUser();
  signedIn();
  server.on('POST /auth/v1/token', () => authSession(user));
  launch();
  expect(await screen.findByText('home-screen')).toBeTruthy();
  await act(async () => {
    router.push('/mfa');
  });

  expect(await screen.findByText('close-here')).toBeTruthy();
  await signOut();
  expect(screen.queryByTestId('welcome')).toBeNull();
  await act(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: 'correct-horse' });
    expect(error).toBeNull();
  });
  fireEvent.press(screen.getByText('close-here'));
  await act(async () => {});
  expect(screen.queryByTestId('welcome')).toBeNull();
  expect(screen.getByText('home-screen')).toBeTruthy();
});
