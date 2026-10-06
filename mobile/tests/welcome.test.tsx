import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { catalogues } from '~/i18n/provider';
import { resetWelcomeForTests, WELCOME_KEY } from '~/features/welcome';
import { SESSION_KEY, supabase } from '~/lib/supabase';
import * as RootLayout from '../src/app/_layout';
import * as TabsLayout from '../src/app/(tabs)/_layout';
import * as TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
import * as WelcomeScreen from '../src/app/welcome';
import { authSession, authUser, mobileConfig, profile } from './auth-fixtures';
import { board, browse, cairo, newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  A first launch, signed out, opens on the welcome: the website's logo, what
  the board is, and the three ways on — create an account, sign in, or skip.
  Skipping or signing in closes it for good; a launch by a link, or with
  somebody signed in, never shows it. The splash screen stays up until it is
  drawn, so Home never flashes first.
*/

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => true),
  hideAsync: jest.fn(async () => true),
}));

const mockStored = new Map<string, string>();
jest.mock('~/lib/session-storage', () => ({
  encryptedSessionStorage: {
    getItem: async (key: string) => mockStored.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockStored.set(key, value);
    },
    removeItem: async (key: string) => {
      mockStored.delete(key);
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

function launch(initialUrl = '/') {
  renderRouter(
    {
      _layout: RootLayout,
      '(tabs)/_layout': TabsLayout,
      [STACK]: TabStack,
      '(tabs)/(home)/index': () => <Text>home-screen</Text>,
      '(tabs)/(jobs)/jobs/index': () => <Text>board-screen</Text>,
      welcome: WelcomeScreen,
    },
    { initialUrl },
  );
}

/** The welcome, as iOS lays it out: drawn. */
async function drawn() {
  const welcome = await screen.findByTestId('welcome');
  fireEvent(welcome, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } });
  await act(async () => {});
}

it('opens a first signed-out launch on the welcome, under the splash screen until it is drawn', async () => {
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

it('closes onto Home when the reader skips it, and is not shown again', async () => {
  launch();
  await drawn();
  fireEvent.press(await screen.findByRole('button', { name: ar.app.welcome.skip }));
  await act(async () => {});
  expect(screen.queryByTestId('welcome')).toBeNull();
  expect(screen.getByText('home-screen')).toBeTruthy();
  expect(await AsyncStorage.getItem(WELCOME_KEY)).toBe('done');

  // The next launch opens on Home.
  screen.unmount();
  resetWelcomeForTests();
  launch();
  expect(await screen.findByText('home-screen')).toBeTruthy();
  await act(async () => {});
  expect(screen.queryByTestId('welcome')).toBeNull();
});

it('leaves a launch by a link where the link leads', async () => {
  launch('/jobs');
  expect(await screen.findByText('board-screen')).toBeTruthy();
  await act(async () => {});
  expect(screen.queryByTestId('welcome')).toBeNull();
  // Not answered: the next plain launch still welcomes.
  expect(await AsyncStorage.getItem(WELCOME_KEY)).toBeNull();
});

it('never shows to somebody signed in, and waits for the first launch with nobody signed in', async () => {
  const user = authUser();
  mockStored.set(SESSION_KEY, JSON.stringify(authSession(user)));
  server.on('GET /auth/v1/user', user);
  server.on('/rest/v1/profiles', [profile]);
  server.on('/rest/v1/rpc/my_company_id', () => null);
  launch();
  expect(await screen.findByText('home-screen')).toBeTruthy();
  await act(async () => {});
  expect(screen.queryByTestId('welcome')).toBeNull();
  // A session the launch found is no answer: a phone signed in when a new welcome came still has it to see.
  expect(await AsyncStorage.getItem(WELCOME_KEY)).toBeNull();

  // Signed out since: the next launch opens on it.
  screen.unmount();
  mockStored.clear();
  resetWelcomeForTests();
  launch();
  expect(await screen.findByRole('button', { name: ar.app.welcome.skip })).toBeTruthy();
});

it('counts signing in as its answer', async () => {
  const user = authUser();
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('GET /auth/v1/user', user);
  server.on('/rest/v1/profiles', [profile]);
  server.on('/rest/v1/rpc/my_company_id', () => null);
  launch();
  await drawn();
  expect(await AsyncStorage.getItem(WELCOME_KEY)).toBeNull();

  await act(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: 'correct-horse' });
    expect(error).toBeNull();
  });
  expect(await AsyncStorage.getItem(WELCOME_KEY)).toBe('done');
});
