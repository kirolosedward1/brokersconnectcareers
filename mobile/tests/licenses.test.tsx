import type { ReactNode } from 'react';
import { Stack } from 'expo-router';
import { renderRouter, screen, within } from 'expo-router/testing-library';
import notices from '@/lib/licenses/app.json';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { ThemeProvider } from '~/theme/provider';
import * as LicensesScreen from '../src/app/(tabs)/(account)/account/licenses';

/*
  The app's open-source notices: the real screen over the committed list
  (src/lib/licenses/app.json, written by scripts/licenses.mjs). What is checked
  is what a reader would look for — a package they know, with its version and
  licence; the font; each licence's text, once — and that every message on
  the screen formats.
*/

// FlatList, which stands in for FlashList everywhere else (tests/setup.ts),
// draws the first ten rows and waits for a scroll that never comes. This list
// is several hundred rows long, and the rows looked for are anywhere in it.
type MockListProps<T> = {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (info: { item: T; index: number }) => ReactNode;
  ListHeaderComponent?: ReactNode;
};
jest.mock('@shopify/flash-list', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { ScrollView, View } = jest.requireActual<typeof import('react-native')>('react-native');
  function FlashList<T>({ data, keyExtractor, renderItem, ListHeaderComponent }: MockListProps<T>) {
    return React.createElement(
      ScrollView,
      null,
      ListHeaderComponent,
      data.map((item, index) => React.createElement(View, { key: keyExtractor(item, index) }, renderItem({ item, index }))),
    );
  }
  return { FlashList };
});

const ar = catalogues.ar;

const warnings: string[] = [];
beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation((...args) => {
    warnings.push(args.map(String).join(' '));
  });
});

beforeEach(() => {
  warnings.length = 0;
});

afterEach(() => {
  // No message may fail to format: the provider reports each one here.
  expect(warnings.filter((warning) => warning.includes('[i18n]'))).toEqual([]);
});

function Root() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </I18nProvider>
    </ThemeProvider>
  );
}

const app = {
  _layout: Root,
  '(tabs)/(account)/_layout': () => <Stack />,
  '(tabs)/(account)/account/licenses': LicensesScreen,
};

describe('the open-source licences screen', () => {
  it('lists a package the app is built on, with its version and licence', async () => {
    renderRouter(app, { initialUrl: '/account/licenses' });

    expect(await screen.findByText(ar.app.licenses.intro)).toBeTruthy();
    const reactNative = notices.packages.find((notice) => notice.name === 'react-native');
    expect(reactNative).toMatchObject({ license: 'MIT', copyright: 'Copyright (c) Meta Platforms, Inc. and affiliates.' });

    // One line to VoiceOver: the name, the version, the licence and whose it is.
    const row = screen.getByLabelText(
      `react-native, ${reactNative?.version}, MIT, Copyright (c) Meta Platforms, Inc. and affiliates.`,
    );
    expect(within(row).getByText('react-native')).toBeTruthy();
    expect(within(row).getByText(`${reactNative?.version} · MIT`)).toBeTruthy();
    expect(within(row).getByText('Copyright (c) Meta Platforms, Inc. and affiliates.')).toBeTruthy();
  });

  it('names the font and the icons, with their licences', async () => {
    renderRouter(app, { initialUrl: '/account/licenses' });

    expect(await screen.findByText('IBM Plex Sans Arabic')).toBeTruthy();
    expect(screen.getByText(/^OFL-1\.1 · @expo-google-fonts\/ibm-plex-sans-arabic /)).toBeTruthy();
    expect(screen.getByText('Lucide')).toBeTruthy();
    expect(screen.getByText(/^ISC.* · lucide-react-native /)).toBeTruthy();
  });

  it('gives each licence its text once', async () => {
    renderRouter(app, { initialUrl: '/account/licenses' });

    await screen.findByText(ar.app.licenses.intro);
    for (const { id } of notices.licenses) {
      expect(screen.getAllByRole('header', { name: id })).toHaveLength(1);
    }
    const mit = notices.licenses.find((license) => license.id === 'MIT');
    expect(screen.getByText(mit?.text ?? '-')).toBeTruthy();
    // Where it was read from, the package name isolated left to right inside the Arabic.
    const from = ar.licenses.textFrom.replace('<v>{source}</v>', `⁦${mit?.source}⁩`);
    expect(screen.getByText(from)).toBeTruthy();
  });
});
