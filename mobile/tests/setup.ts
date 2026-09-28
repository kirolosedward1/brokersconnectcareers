/*
  Native modules a unit test cannot reach, replaced with their published
  in-memory stand-ins. Loaded before every test file (jest.config.js).
*/
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot import.
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// The build-time settings every client reads, pointed nowhere: a test that
// reaches the network fails loudly instead of touching a real project.
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:9';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??= 'test-publishable-key';
process.env.EXPO_PUBLIC_SITE_URL ??= 'http://127.0.0.1:9';

// FlashList measures its window natively; in a test there is none, and the
// package's own jestSetup names an export 2.0 no longer has. FlatList takes
// the same props the app uses and draws every row.
jest.mock('@shopify/flash-list', () => ({
  FlashList: jest.requireActual('react-native').FlatList,
}));
