import { StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HOME_HEADER, HomeFrame } from '~/components/home/home-frame';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { ThemeProvider } from '~/theme/provider';

/*
  Home's header, its own: slimmer than iOS's bar, the website's logo at its
  start — in Arabic the right — and the bell at its end. It stays put as the
  page scrolls, as a navigation bar does (and as the tab bar keeps its size:
  tests/tab-bar.test.tsx).
*/

jest.mock('~/components/notifications/header-bell', () => {
  const { createElement } = jest.requireActual('react');
  const { Text: NativeText } = jest.requireActual('react-native');
  return { useHeaderBell: () => () => createElement(NativeText, { testID: 'bell' }, 'bell') };
});

/** An iPhone with a Dynamic Island: the status bar 59 points tall, the home indicator 34. */
const iPhone = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function draw() {
  render(
    <SafeAreaProvider initialMetrics={iPhone}>
      <ThemeProvider>
        <I18nProvider>
          <HomeFrame>
            <Text>page</Text>
          </HomeFrame>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

it('is slimmer than a navigation bar, with the logo, smaller, at its start and the bell at its end', () => {
  draw();
  const header = screen.getByTestId('home-header');
  expect(StyleSheet.flatten(header.props.style).height).toBe(HOME_HEADER);
  expect(HOME_HEADER).toBeLessThan(44);
  // In a row laid out right to left, the first is at the right.
  const order = screen.UNSAFE_root.findAll((node) => ['brand-logo', 'bell'].includes(node.props.testID) && typeof node.type === 'string');
  expect(order.map((node) => node.props.testID)).toEqual(['brand-logo', 'bell']);
  expect(screen.getByRole('image', { name: catalogues.ar.meta.siteName })).toBeTruthy();
  expect(screen.getByText('page')).toBeTruthy();
});

it('stays in place: nothing moves it, and the page starts under it', () => {
  draw();
  const frame = StyleSheet.flatten(screen.getByTestId('home-frame').props.style) as {
    marginBottom?: number;
    transform?: unknown;
  };
  expect(frame.marginBottom).toBeUndefined();
  expect(frame.transform).toBeUndefined();
});
