import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderRouter, screen, waitFor } from 'expo-router/testing-library';
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
  const getItem = jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key: string) => {
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
    getItem.mockRestore();
  }
});
