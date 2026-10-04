import { useContext } from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import { router } from 'expo-router';
import { render } from '@testing-library/react-native';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { InSheet } from '~/components/ui/states';
import { catalogues } from '~/i18n/provider';
import * as RootLayout from '../src/app/_layout';
import * as TabsLayout from '../src/app/(tabs)/_layout';
import * as TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
import * as BoardScreen from '../src/app/(tabs)/(jobs)/jobs/index';
import { mobileConfig } from './auth-fixtures';
import { board, browse, cairo, listing, newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  The whole app's first frame, through the real root layout: what it waits
  for before drawing anything. A cold start draws the board kept from the last
  run at once, so the companies the reader hid on this phone have to be known
  before that — or their listings show until the phone answers.
*/

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => true),
  hideAsync: jest.fn(async () => true),
}));

jest.mock('~/lib/session-storage', () => ({
  encryptedSessionStorage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const server = fakeServer();
const HIDDEN_KEY = 'bc.hidden-companies.v1';
const other = {
  ...listing,
  id: '5b0c7d1e-0000-4000-8000-000000000301',
  slug: 'other-c3d4',
  title_ar: 'مدير مبيعات',
  company_id: 'c0000000-0000-4000-8000-000000000002',
  company: { ...listing.company, id: 'c0000000-0000-4000-8000-000000000002', slug: 'other-brokers' },
};

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  await AsyncStorage.clear();
  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('/rest/v1/districts', [newCairo]);
  server.on('/rest/v1/governorates', [cairo]);
  server.on('/api/mobile/v1/browse', browse);
  server.on('/api/mobile/v1/jobs', board([listing, other]));
});

it("draws nothing before the phone has said which companies are hidden, and then never their listings", async () => {
  // A phone with one company hidden and nothing else kept, slow to answer for
  // the hidden companies.
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The storage module is already a mock: spyOn hands back that same mock, and
  // mockRestore would leave it with no implementation for the tests after this one.
  const getItem = jest.spyOn(AsyncStorage, 'getItem');
  const stored = getItem.getMockImplementation();
  getItem.mockImplementation(async (key: string) => {
    if (key !== HIDDEN_KEY) return null;
    await gate;
    return JSON.stringify([listing.company.id]);
  });

  try {
    renderRouter(
      {
        _layout: RootLayout,
        '(tabs)/_layout': TabsLayout,
        '(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout': TabStack,
        '(tabs)/(jobs)/jobs/index': BoardScreen,
        '(tabs)/(home)/index': () => <Text>home</Text>,
      },
      { initialUrl: '/jobs' },
    );

    // Given every chance to draw the board — fonts, the session and the
    // board's read all answer — nothing is drawn while the phone has not said
    // which companies are hidden. (Without the wait the board was on screen
    // well inside this, the hidden company's listing on it.)
    await expect(waitFor(() => expect(screen.getByText(other.title_ar)).toBeTruthy(), { timeout: 2000 })).rejects.toThrow();
    expect(screen.queryByText(listing.title_ar)).toBeNull();

    await act(async () => release());
    expect(await screen.findByText(other.title_ar)).toBeTruthy();
    expect(screen.queryByText(listing.title_ar)).toBeNull();
  } finally {
    if (stored) getItem.mockImplementation(stored);
    else getItem.mockRestore();
  }
});

describe('a screen that throws while it is drawn', () => {
  const ar = catalogues.ar;
  const STACK = '(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';

  it('says something went wrong and draws it again on request, and the rest of the app stays', async () => {
    // A Home that fails to draw until it is asked again.
    let broken = true;
    function Home() {
      if (broken) throw new Error('a field the screen did not expect');
      return <Text>home, drawn</Text>;
    }
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderRouter(
        { _layout: RootLayout, '(tabs)/_layout': TabsLayout, [STACK]: TabStack, '(tabs)/(home)/index': Home, '(tabs)/(jobs)/jobs/index': BoardScreen },
        { initialUrl: '/' },
      );
      expect(await screen.findByText(ar.common.error)).toBeTruthy();
      expect(screen.getByText(ar.common.errorBody)).toBeTruthy();

      // The rest of the app is still there: another tab opens and draws.
      act(() => router.navigate('/jobs'));
      // Longer than findBy's own second: the board waits for the session and the hidden companies first.
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });
      // (The other company's listing: the test above leaves Nile Brokers hidden on this phone.)
      expect(await screen.findByText(other.title_ar)).toBeTruthy();
      act(() => router.navigate('/'));

      // And Home draws when asked again.
      broken = false;
      fireEvent.press(await screen.findByRole('button', { name: ar.common.retry }));
      expect(await screen.findByText('home, drawn')).toBeTruthy();
      expect(screen.queryByText(ar.common.error)).toBeNull();
    } finally {
      logged.mockRestore();
    }
  });

  it('has a last screen of its own for when what failed is under every screen, with the splash taken down', async () => {
    const hide = jest.mocked(SplashScreen.hideAsync);
    hide.mockClear();
    const retry = jest.fn(async () => {});
    const { ErrorBoundary } = RootLayout as { ErrorBoundary?: (props: { error: Error; retry: () => Promise<void> }) => React.ReactNode };
    expect(ErrorBoundary).toBeDefined();
    if (!ErrorBoundary) return;
    // Drawn with no provider around it: the theme, the catalogue and the session are what failed.
    render(<ErrorBoundary error={new Error('the cache could not be read')} retry={retry} />);
    expect(screen.getByText(ar.common.error)).toBeTruthy();
    expect(screen.getByText(ar.common.errorBody)).toBeTruthy();
    await waitFor(() => expect(hide).toHaveBeenCalled());
    fireEvent.press(screen.getByRole('button', { name: ar.common.retry }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('a screen the root stack presents as a sheet', () => {
  // What is drawn in a sheet is measured from the sheet's own top, which is
  // below the status bar (src/components/ui/states.tsx, InSheet).
  function Where({ name }: { name: string }) {
    return <Text>{`${name}: ${useContext(InSheet) ? 'sheet' : 'screen'}`}</Text>;
  }
  const STACK = '(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';

  it('is told it is one; the tabs under it are not', async () => {
    renderRouter(
      {
        _layout: RootLayout,
        '(tabs)/_layout': TabsLayout,
        [STACK]: TabStack,
        '(tabs)/(home)/index': () => <Where name="home" />,
        'auth/callback': () => <Where name="callback" />,
      },
      { initialUrl: '/' },
    );
    expect(await screen.findByText('home: screen')).toBeTruthy();
    act(() => router.push('/auth/callback'));
    expect(await screen.findByText('callback: sheet')).toBeTruthy();
  });
});
