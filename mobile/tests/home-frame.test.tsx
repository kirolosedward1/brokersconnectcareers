import { Animated, StyleSheet, Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HOME_HEADER, HomeFrame } from '~/components/home/home-frame';
import { resetTabBarForTests, setTabBarSmall } from '~/features/tab-bar';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { ThemeProvider } from '~/theme/provider';
import { useReduceMotion } from '~/theme/reduce-motion';
import { motion } from '~/theme/tokens';

/*
  Home's header, its own: slimmer than iOS's bar, the website's logo at its
  start — in Arabic the right — and the bell at its end. Not fixed: it slides
  away as the reader scrolls down a list and comes back as they scroll up, on
  the same signal as the tab bar (tests/tab-bar.test.tsx). It moves on the
  native thread; a test sees what it was asked to do.
*/

jest.mock('~/components/notifications/header-bell', () => {
  const { createElement } = jest.requireActual('react');
  const { Text: NativeText } = jest.requireActual('react-native');
  return { useHeaderBell: () => () => createElement(NativeText, { testID: 'bell' }, 'bell') };
});
jest.mock('~/theme/reduce-motion', () => ({ useReduceMotion: jest.fn(() => false) }));

let timing: jest.SpyInstance;
beforeEach(() => {
  resetTabBarForTests();
  jest.mocked(useReduceMotion).mockReturnValue(false);
  timing = jest.spyOn(Animated, 'timing');
});
afterEach(() => timing.mockRestore());

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

/** The header's last move, as asked of the native thread. */
const lastMove = () => timing.mock.calls.filter(([, config]) => config.duration === motion.bars).at(-1)?.[1];

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

it('slides away as a list scrolls down, and comes back as it scrolls up', () => {
  draw();
  // Drawn in place, the page under it reaching a header's height past the foot of the screen.
  const frame = StyleSheet.flatten(screen.getByTestId('home-frame').props.style) as {
    marginBottom?: number;
    transform?: { translateY?: unknown }[];
  };
  expect(frame.marginBottom).toBe(-HOME_HEADER);
  expect(frame.transform).toEqual([{ translateY: 0 }]);

  act(() => setTabBarSmall(true));
  expect(lastMove()).toEqual(expect.objectContaining({ toValue: 1, useNativeDriver: true }));
  act(() => setTabBarSmall(false));
  expect(lastMove()).toEqual(expect.objectContaining({ toValue: 0, useNativeDriver: true }));
});

it('stays with Reduce Motion on', () => {
  jest.mocked(useReduceMotion).mockReturnValue(true);
  draw();
  act(() => setTabBarSmall(true));
  expect(lastMove()).toEqual(expect.objectContaining({ toValue: 0 }));
});
