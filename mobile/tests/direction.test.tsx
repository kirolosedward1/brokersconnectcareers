import { I18nManager, StyleSheet, Text } from 'react-native';
import * as Updates from 'expo-updates';
import { render } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';
import { Text as AppText, textAlignEnd, textAlignStart } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { resetWelcomeForTests } from '~/features/welcome';
import { catalogues } from '~/i18n/provider';
import { appDirection, setDrawnLocale } from '~/lib/direction';
import { ThemeProvider } from '~/theme/provider';
import * as RootLayout from '../src/app/_layout';
import * as TabsLayout from '../src/app/(tabs)/_layout';
import * as TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)/_layout';
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

const STACK = '(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)/_layout';
const server = fakeServer();

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  // Without the welcome a signed-out launch opens on (tests/welcome.test.tsx has it): this opens on Home.
  resetWelcomeForTests(false);
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
  await renderRouter(
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

  // The tab bar is the app's own, laid out as every view is — Home first, so
  // at the right — with nothing on the way to it turning it left to right
  // (iOS's own laid itself out in the language the app runs in).
  expect(screen.getAllByRole('tab')[0].props.accessibilityLabel).toBe(catalogues.ar.app.tabs.home);
  for (let node = screen.getByTestId('tab-bar'); node; node = node.parent as typeof node) {
    const style = typeof node.props.style === 'function' ? undefined : StyleSheet.flatten(node.props.style);
    expect(style?.direction).not.toBe('ltr');
  }

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

describe('a label', () => {
  afterEach(() => {
    setDrawnLocale('ar');
    Object.defineProperty(I18nManager, 'isRTL', { configurable: true, value: false });
  });

  it('puts Arabic on the right when the phone has not mirrored, and hands over left when it has', () => {
    // Expo Go can come up left to right while the app is Arabic. `left` then
    // stays on the left. While the phone is already right to left it swaps
    // `left` and `right` once, so `right` would put Arabic back on the left.
    expect(I18nManager.isRTL).toBe(false);
    expect(textAlignStart('ios', 'rtl', false)).toBe('right');
    expect(textAlignStart('android', 'rtl', false)).toBe('right');
    expect(textAlignStart('ios', 'rtl', true)).toBe('left');
    expect(textAlignStart('android', 'rtl', true)).toBe('left');
    expect(textAlignEnd('ios', 'rtl', false)).toBe('left');
    expect(textAlignEnd('ios', 'rtl', true)).toBe('right');

    // English starts on the left, and the same swap applies.
    expect(textAlignStart('ios', 'ltr', false)).toBe('left');
    expect(textAlignStart('ios', 'ltr', true)).toBe('right');
    expect(textAlignEnd('ios', 'ltr', false)).toBe('right');
    expect(textAlignEnd('ios', 'ltr', true)).toBe('left');

    // The web does not swap, even if a caller says the phone would.
    expect(textAlignStart('web', 'rtl', false)).toBe('right');
    expect(textAlignStart('web', 'rtl', true)).toBe('right');
    expect(textAlignStart('web', 'ltr', false)).toBe('left');
    expect(textAlignStart('web', 'ltr', true)).toBe('left');
    expect(textAlignEnd('web', 'rtl', true)).toBe('left');
    expect(textAlignEnd('web', 'ltr', false)).toBe('right');
  });

  it('follows the app language, and reads whether the phone will mirror', () => {
    setDrawnLocale('ar');
    expect(textAlignStart('ios')).toBe('right');
    expect(textAlignStart('android')).toBe('right');
    expect(textAlignStart('web')).toBe('right');

    setDrawnLocale('en');
    expect(textAlignStart('ios')).toBe('left');
    expect(textAlignStart('web')).toBe('left');

    setDrawnLocale('ar');
    Object.defineProperty(I18nManager, 'isRTL', { configurable: true, value: true });
    expect(textAlignStart('ios')).toBe('left');
    expect(textAlignStart('android')).toBe('left');
    expect(textAlignEnd('ios')).toBe('right');
  });

  it('draws Arabic from the right while the phone is left to right', () => {
    expect(I18nManager.isRTL).toBe(false);
    render(
      <ThemeProvider>
        <AppText testID="label">مرحبا</AppText>
      </ThemeProvider>,
    );
    expect(StyleSheet.flatten(screen.getByTestId('label').props.style).textAlign).toBe('right');
  });

  it('draws Arabic with left while the phone is right to left, so the swap lands on the right', () => {
    Object.defineProperty(I18nManager, 'isRTL', { configurable: true, value: true });
    render(
      <ThemeProvider>
        <AppText testID="label-mirrored">مرحبا</AppText>
      </ThemeProvider>,
    );
    expect(StyleSheet.flatten(screen.getByTestId('label-mirrored').props.style).textAlign).toBe('left');
  });
});
