import { I18nManager, StyleSheet, Text } from 'react-native';
import * as Updates from 'expo-updates';
import { render } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';
import { TextField } from '~/components/ui/text-field';
import { appDirection } from '~/lib/direction';
import { ThemeProvider } from '~/theme/provider';
import * as RootLayout from '../src/app/_layout';
import * as TabsLayout from '../src/app/(tabs)/_layout';
import * as TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
import { mobileConfig } from './auth-fixtures';
import { board, browse, cairo, newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  Which way the app runs is the app's own to say. Expo Go creates the screen
  before it applies the app's right to left whenever it opens an update from
  the network or comes back from its own home screen, and lays native bars out
  in its own language: on the owner's iPhone the app came up left to right,
  tab bar and all, and starting it again did not correct it. So every view is
  laid out in the app's direction, every navigator's header is told it, and
  so is the tab bar — here with React Native saying left to right throughout,
  as on an iPhone in English, and the app still running right to left.
*/

jest.mock('expo-updates', () => ({ reloadAsync: jest.fn(async () => {}), updateId: null }));
// The app as app.config.ts builds it: Arabic only, right to left.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { forcesRTL: true } } },
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
}));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => true),
  hideAsync: jest.fn(async () => true),
}));
jest.mock('~/lib/session-storage', () => ({
  encryptedSessionStorage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const STACK = '(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
const server = fakeServer();

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(() => {
  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('/rest/v1/districts', [newCairo]);
  server.on('/rest/v1/governorates', [cairo]);
  server.on('/api/mobile/v1/browse', browse);
  server.on('/api/mobile/v1/jobs', board([]));
});

/** Every host element of a native component, by its name. */
function hosts(name: string) {
  return screen.UNSAFE_root.findAll((node) => node.type === (name as unknown as typeof node.type));
}

it('is right to left while the app is Arabic only, whatever React Native says', () => {
  expect(I18nManager.isRTL).toBe(false);
  expect(appDirection).toBe('rtl');
});

it('lays every view out right to left, tells the headers and the tab bar, and never starts the app again', async () => {
  renderRouter(
    {
      _layout: RootLayout,
      '(tabs)/_layout': TabsLayout,
      [STACK]: TabStack,
      '(tabs)/(home)/index': () => <Text>home-screen</Text>,
      '(tabs)/(jobs)/jobs/index': () => <Text>board</Text>,
    },
    { initialUrl: '/' },
  );
  await screen.findByText('home-screen');

  // Every view under the root: React Native lays out and aligns text by the nearest direction set.
  expect(StyleSheet.flatten(screen.getByTestId('app-direction').props.style).direction).toBe('rtl');

  // The tab bar: iOS would lay it out in the language the app runs in.
  const tabs = hosts('RNSTabsHostIOS');
  expect(tabs.length).toBeGreaterThan(0);
  expect(tabs[0].props.layoutDirection).toBe('rtl');

  // The headers and their back gestures: the native stack's own direction.
  const headers = hosts('RNSScreenStackHeaderConfig');
  expect(headers.length).toBeGreaterThan(0);
  for (const header of headers) expect(header.props.direction).toBe('rtl');

  expect(Updates.reloadAsync).not.toHaveBeenCalled();
});

describe('a field', () => {
  // React Native mirrors 'left' for text it lays out itself, not for what is typed into a field.
  function alignment(element: React.ReactElement) {
    render(<ThemeProvider>{element}</ThemeProvider>);
    return StyleSheet.flatten(screen.getByTestId('field').props.style).textAlign;
  }

  it('starts Arabic at the right edge', () => {
    expect(alignment(<TextField testID="field" value="" onChangeText={() => {}} />)).toBe('right');
  });

  it('starts an email at the left edge, as it is read', () => {
    expect(alignment(<TextField testID="field" ltr value="" onChangeText={() => {}} />)).toBe('left');
  });
});
