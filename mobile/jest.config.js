/**
 * Jest for the app: jest-expo's preset, which already maps the tsconfig paths
 * (`@/*` to the website's ../src, `~/*` to ./src, `zod` to this project's
 * copy), plus two things the preset cannot know.
 *
 * Packages published only as ES modules — the website's i18n core (use-intl
 * and the formatjs parser under it), lucide's React Native build — are
 * compiled like the app's own code instead of skipped.
 *
 * A bare import made from one of the website's files resolves as if made from
 * this project (jest.resolver.js), exactly as metro.config.js makes Metro do:
 * the app's copy of a package, never the website's.
 */
// jest-expo's own list first, then this project's.
const esmPackages = [
  '.pnpm',
  'react-native',
  '@react-native',
  '@react-native-community',
  'expo',
  '@expo',
  '@expo-google-fonts',
  'react-navigation',
  '@react-navigation',
  '@sentry/react-native',
  'native-base',
  'standard-navigation',
  'use-intl',
  'intl-messageformat',
  '@formatjs',
  '@shopify/flash-list',
  '@tanstack',
];

module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts?(x)'],
  resolver: '<rootDir>/jest.resolver.js',
  setupFiles: ['<rootDir>/tests/setup.ts'],
  moduleNameMapper: {
    // Its React Native entry is an .mjs file, which Jest's transform does not
    // pick up; the CommonJS build draws the same icons.
    '^lucide-react-native$': '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
  transformIgnorePatterns: [
    `/node_modules/(?!(${esmPackages.join('|')}))`,
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
  ],
};
