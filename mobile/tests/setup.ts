/*
  Native modules a unit test cannot reach, replaced with their published
  in-memory stand-ins. Loaded before every test file (jest.config.js).
*/
import { installIntlPolyfills } from '~/lib/intl-polyfills';

// Format as the phone does. Node's own Intl knows every locale; the phone runs
// the formatjs polyfills with the few the app loads, and a formatter that
// worked in Node threw on the phone (src/lib/format.ts, formatRelativeDay).
// Node's own is kept aside for tests/intl.test.ts, which compares the two.
(globalThis as { nodeIntl?: typeof Intl }).nodeIntl = {
  ...Intl,
  DateTimeFormat: Intl.DateTimeFormat,
  NumberFormat: Intl.NumberFormat,
  PluralRules: Intl.PluralRules,
  RelativeTimeFormat: Intl.RelativeTimeFormat,
  Locale: Intl.Locale,
  getCanonicalLocales: Intl.getCanonicalLocales,
};
installIntlPolyfills({ force: true });

// And without the built-ins Node has and Hermes, the phone's engine, does not
// (checked against Hermes V1, which React Native 0.86 runs): code using one
// would pass every test here and throw on the phone. structuredClone is
// missing from Hermes too, but Expo installs it (expo/src/winter).
const hermesLacks: [object, string][] = [
  [Array.prototype, 'toSorted'],
  [Array, 'fromAsync'],
  [Object, 'groupBy'],
  [Map, 'groupBy'],
  [ArrayBuffer.prototype, 'transfer'],
  [globalThis, 'Iterator'],
];
const iteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())) as object;
for (const helper of ['map', 'filter', 'take', 'drop', 'flatMap', 'reduce', 'toArray', 'forEach', 'some', 'every', 'find']) {
  hermesLacks.push([iteratorPrototype, helper]);
}
for (const [owner, name] of hermesLacks) delete (owner as Record<string, unknown>)[name];

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot import.
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// The build-time settings every client reads, pointed nowhere: a test that
// reaches the network fails loudly instead of touching a real project.
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:9';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??= 'test-publishable-key';
process.env.EXPO_PUBLIC_SITE_URL ??= 'http://127.0.0.1:9';

// React Native's test window reports a font scale of 2, an accessibility
// text size, where the segmented control becomes a menu. The suites describe
// the phone as most people set it; tests/segmented.test.tsx covers the large
// sizes on purpose.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => {
  const { Dimensions } = jest.requireActual('react-native');
  return { __esModule: true, default: () => ({ ...Dimensions.get('window'), fontScale: 1 }) };
});

// FlashList measures its window natively; in a test there is none, and the
// package's own jestSetup names an export 2.0 no longer has. FlatList takes
// the same props the app uses and draws every row.
jest.mock('@shopify/flash-list', () => ({
  FlashList: jest.requireActual('react-native').FlatList,
}));

// The WebView is native. A stand-in records what the latest one was given and
// how many have been loaded, so a test can play the captcha page's part —
// posting its messages — and see a spent token make the app load another.
jest.mock('react-native-webview', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const state: { latest: Record<string, unknown> | null; loads: number } = { latest: null, loads: 0 };
  function WebView(props: Record<string, unknown>) {
    state.latest = props;
    React.useEffect(() => {
      state.loads += 1;
    }, []);
    return React.createElement(View, { testID: 'webview' });
  }
  return { WebView, __webview: state };
});

// Sign in with Apple is the system's sheet. Unavailable unless a test says
// otherwise, and its button a plain one a test can press.
jest.mock('expo-apple-authentication', () => {
  const React = jest.requireActual('react');
  const { Pressable } = jest.requireActual('react-native');
  return {
    isAvailableAsync: jest.fn(async () => false),
    signInAsync: jest.fn(),
    formatFullName: jest.fn((name: { givenName?: string | null; familyName?: string | null }) =>
      [name.givenName, name.familyName].filter(Boolean).join(' '),
    ),
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    AppleAuthenticationButton: ({ onPress }: { onPress: () => void }) =>
      React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: 'Sign in with Apple', onPress }),
  };
});

// Notifications are the system's. The phone has not been asked yet, asking
// grants, a token is always to be had, and nothing has been tapped — unless a
// test says otherwise.
jest.mock('expo-notifications', () => {
  const subscription = () => ({ remove: jest.fn() });
  return {
    DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
    IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
    AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn(async () => null),
    getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' })),
    requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true, canAskAgain: true, expires: 'never' })),
    getExpoPushTokenAsync: jest.fn(async () => ({ type: 'expo', data: 'ExponentPushToken[test-token-0001]' })),
    addPushTokenListener: jest.fn(subscription),
    addNotificationReceivedListener: jest.fn(subscription),
    addNotificationResponseReceivedListener: jest.fn(subscription),
    getLastNotificationResponse: jest.fn(() => null),
    clearLastNotificationResponse: jest.fn(),
    setBadgeCountAsync: jest.fn(async () => true),
    unregisterForNotificationsAsync: jest.fn(async () => {}),
  };
});
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));
