import { Modal, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { catalogues } from '~/i18n/provider';
import { resetLaunchForTests } from '~/features/launch';
import { resetWelcomeForTests } from '~/features/welcome';
import { SESSION_KEY, supabase } from '~/lib/supabase';
import { useSheet } from '~/lib/use-sheet';
import { type } from '~/theme/tokens';
import * as RootLayout from '../src/app/_layout';
import * as TabsLayout from '../src/app/(tabs)/_layout';
import * as TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)/_layout';
import * as WelcomeScreen from '../src/app/welcome';
import { authSession, authUser, mobileConfig, profile } from './auth-fixtures';
import { board, browse, cairo, newCairo } from './fixtures';
import { fakeServer } from './server';

/** The curtain is hidden from VoiceOver, so queries have to be told to look at it. */
const HIDDEN = { includeHiddenElements: true };

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
const STACK = '(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)/_layout';
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
  resetLaunchForTests();
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

/** Home with a sheet of its own, as the board has its filters. */
function HomeWithSheet() {
  const sheet = useSheet();
  return (
    <>
      <Pressable accessibilityRole="button" onPress={sheet.show}>
        <Text>open-sheet</Text>
      </Pressable>
      {sheet.mounted ? (
        <Modal visible={sheet.open} presentationStyle="pageSheet" onDismiss={sheet.onDismiss}>
          <Text>a-sheet</Text>
        </Modal>
      ) : null}
    </>
  );
}

async function launch(initialUrl = '/', home: () => React.JSX.Element = () => <Text>home-screen</Text>) {
  await renderRouter(
    {
      _layout: RootLayout,
      '(tabs)/_layout': TabsLayout,
      [STACK]: TabStack,
      '(tabs)/(home)/index': home,
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

/**
 * The welcome, as iOS lays it out and fades it in: on screen once the fade
 * has had its time (iOS says so as the screen appears, which a test cannot).
 */
async function drawn() {
  const welcome = await screen.findByTestId('welcome');
  fireEvent(welcome, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } });
  await act(async () => {
    jest.advanceTimersByTime(600);
  });
}

it('opens a signed-out launch on the welcome, over the launch curtain, which lifts once it is drawn', async () => {
  await launch();
  const skip = await screen.findByRole('button', { name: ar.app.welcome.skip });
  // Skip says where it leads.
  expect(skip.props.accessibilityHint).toBe(ar.app.welcome.skipHint);
  expect(screen.getByRole('button', { name: ar.nav.signUp })).toBeTruthy();
  expect(screen.getByRole('button', { name: ar.nav.signIn })).toBeTruthy();
  // The website's logo, read as its name.
  expect(screen.getByRole('image', { name: ar.meta.siteName })).toBeTruthy();
  expect(screen.getByText(ar.landingPage.hero.title)).toBeTruthy();
  // The curtain stays until the welcome is on screen over it, laid out or not.
  expect(screen.getByTestId('launch-screen', HIDDEN)).toBeTruthy();
  fireEvent(screen.getByTestId('welcome'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } });
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(screen.getByTestId('launch-screen', HIDDEN)).toBeTruthy();
  expect(hide).not.toHaveBeenCalled();

  await drawn();
  expect(hide).toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByTestId('launch-screen', HIDDEN)).toBeNull());
});

it('never scrolls, and sets the words smaller when they do not fit', async () => {
  await launch();
  await drawn();
  expect(screen.UNSAFE_queryAllByType(ScrollView)).toHaveLength(0);
  const headline = () => screen.getByText(ar.landingPage.hero.title);
  const size = () => StyleSheet.flatten(headline().props.style).fontSize;
  const layout = (testID: string, height: number) =>
    fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } });

  layout('welcome-words', 400);
  layout('welcome-words-content', 300);
  await act(async () => {});
  expect(size()).toBe(type.display.fontSize);

  // Taller than its space (the largest text sizes): a step smaller, and again until it fits.
  layout('welcome-words-content', 520);
  await act(async () => {});
  expect(size()).toBe(type.title.fontSize);
  layout('welcome-words-content', 450);
  await act(async () => {});
  expect(size()).toBe(type.headline.fontSize);
  layout('welcome-words-content', 380);
  await act(async () => {});
  expect(size()).toBe(type.headline.fontSize);
  expect(headline().props.maxFontSizeMultiplier).toBe(1.3);
});

it('closes onto Home when the reader skips it, and later launches open on Home', async () => {
  await launch();
  await drawn();
  fireEvent.press(await screen.findByRole('button', { name: ar.app.welcome.skip }));
  await act(async () => {});
  expect(screen.queryByTestId('welcome')).toBeNull();
  expect(screen.getByText('home-screen')).toBeTruthy();
  // The skip is kept on the phone.
  expect(await AsyncStorage.getItem('bc-welcome-skipped')).toBe('1');

  // The next launch, still signed out, opens on Home: the welcome is not shown again.
  screen.unmount();
  resetWelcomeForTests();
  resetLaunchForTests();
  await launch();
  expect(await screen.findByText('home-screen')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(screen.queryByTestId('welcome')).toBeNull();
});

it('opens again after a sign-out, at once and at the next launch, though it was skipped before', async () => {
  await AsyncStorage.setItem('bc-welcome-skipped', '1');
  signedIn();
  await launch();
  expect(await screen.findByText('home-screen')).toBeTruthy();
  await act(async () => {});
  expect(screen.queryByTestId('welcome')).toBeNull();

  await signOut();
  expect(await screen.findByRole('button', { name: ar.app.welcome.skip })).toBeTruthy();
  await waitFor(async () => expect(await AsyncStorage.getItem('bc-welcome-skipped')).toBeNull());

  // Not skipped this time: the next launch welcomes them again.
  screen.unmount();
  resetWelcomeForTests();
  resetLaunchForTests();
  await launch();
  expect(await screen.findByRole('button', { name: ar.app.welcome.skip })).toBeTruthy();
});

it('leaves a launch by a link where the link leads', async () => {
  await launch('/jobs');
  expect(await screen.findByText('board-screen')).toBeTruthy();
  await act(async () => {});
  expect(screen.queryByTestId('welcome')).toBeNull();
});

it('never shows to somebody signed in, and opens when they sign out', async () => {
  signedIn();
  await launch();
  expect(await screen.findByText('home-screen')).toBeTruthy();
  await act(async () => {});
  expect(screen.queryByTestId('welcome')).toBeNull();

  await signOut();
  fireEvent.press(await screen.findByRole('button', { name: ar.app.welcome.skip }));
  await act(async () => {});
  expect(screen.queryByTestId('welcome')).toBeNull();
  expect(screen.getByText('home-screen')).toBeTruthy();
});

it('opens after a session ends only once a sheet still showing has gone, which iOS would otherwise take down unawares', async () => {
  signedIn();
  await launch('/', HomeWithSheet);
  const open = await screen.findByRole('button', { name: 'open-sheet' });
  await act(async () => {});
  fireEvent.press(open);
  const sheet = () => screen.UNSAFE_getAllByType(Modal).find((modal) => modal.props.presentationStyle === 'pageSheet');
  await waitFor(() => expect(sheet()?.props.visible).toBe(true));
  await signOut();
  // The sheet closes through its own state first; the welcome waits for it.
  await waitFor(() => expect(sheet()?.props.visible).toBe(false));
  expect(screen.queryByTestId('welcome')).toBeNull();
  act(() => sheet()?.props.onDismiss());
  expect(await screen.findByTestId('welcome')).toBeTruthy();
});

it('waits for the screen somebody signed out from to close, and opens over the tabs', async () => {
  signedIn();
  await launch();
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
  await launch();
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

it('is not opened a second time after signing out of a screen that sat over it', async () => {
  const user = authUser();
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('GET /auth/v1/user', user);
  server.on('/rest/v1/profiles', [profile]);
  server.on('/rest/v1/rpc/my_company_id', () => null);
  await launch();
  await drawn();
  expect(await screen.findByRole('button', { name: ar.app.welcome.skip })).toBeTruthy();

  // Signed in from the welcome, which hands over to the code screen on top of it…
  await act(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: 'correct-horse' });
    expect(error).toBeNull();
  });
  await act(async () => {
    router.push('/mfa');
  });
  expect(await screen.findByText('close-here')).toBeTruthy();
  // …signed out there, and back on the welcome that was under it.
  await signOut();
  fireEvent.press(screen.getByText('close-here'));
  fireEvent.press(await screen.findByRole('button', { name: ar.app.welcome.skip }));
  await act(async () => {});
  // Skipped once, gone: not opened again over the tabs.
  expect(screen.queryByTestId('welcome')).toBeNull();
  expect(screen.getByText('home-screen')).toBeTruthy();
});
