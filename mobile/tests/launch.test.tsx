import { Animated, StyleSheet } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { LaunchCurtain } from '~/components/brand/launch-screen';
import { LAUNCH_HOLD_MS, launchReady, resetLaunchForTests } from '~/features/launch';
import { useReduceMotion } from '~/theme/reduce-motion';

/** The curtain is hidden from VoiceOver, so queries have to be told to look at it. */
const HIDDEN = { includeHiddenElements: true };

/*
  The app's opening: the logo mark at the middle of the page and the wordmark
  at its foot, over everything from the first frame. It takes the phone's own
  launch screen (or Expo Go's) down as soon as it is laid out over it — under
  that screen, nobody ever saw it — and lifts once the first screen is ready
  and it has been up its moment, never before either.
*/

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => true),
  hideAsync: jest.fn(async () => true),
}));
jest.mock('~/theme/reduce-motion', () => ({ useReduceMotion: jest.fn(() => false) }));

const hide = jest.mocked(SplashScreen.hideAsync);

beforeEach(() => {
  jest.useFakeTimers();
  resetLaunchForTests();
  hide.mockClear();
  jest.mocked(useReduceMotion).mockReturnValue(false);
});
afterEach(() => {
  jest.useRealTimers();
});

/** Lets the clock run on, and whatever it starts (the hold, the lift) with it. */
async function wait(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

type Style = { opacity?: unknown; transform?: unknown[] };
const styleOf = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID, HIDDEN).props.style) as Style;

it('draws the mark and the wordmark, hidden from VoiceOver, and takes the launch screen down once laid out over it', () => {
  render(<LaunchCurtain />);
  const curtain = screen.getByTestId('launch-screen', HIDDEN);
  expect(curtain.props.accessibilityElementsHidden).toBe(true);
  expect(curtain.props.importantForAccessibility).toBe('no-hide-descendants');
  // Over the whole page, taking the taps meant for what is still getting ready under it.
  expect(curtain.props.pointerEvents).toBe('auto');
  expect(hide).not.toHaveBeenCalled();

  fireEvent(curtain, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } });
  expect(hide).toHaveBeenCalledTimes(1);
});

it('still takes the launch screen down when it is never laid out', async () => {
  render(<LaunchCurtain />);
  await wait(1500);
  expect(hide).toHaveBeenCalled();
});

it('waits for the first screen, however long that takes', async () => {
  render(<LaunchCurtain />);
  await wait(LAUNCH_HOLD_MS * 10);
  expect(screen.getByTestId('launch-screen', HIDDEN)).toBeTruthy();

  await act(async () => launchReady());
  // Lifting: the first taps go through to the app.
  expect(screen.getByTestId('launch-screen', HIDDEN).props.pointerEvents).toBe('none');
  await wait(1000);
  expect(screen.queryByTestId('launch-screen', HIDDEN)).toBeNull();
});

it('stays up its moment even when the app is ready at once', async () => {
  render(<LaunchCurtain />);
  await act(async () => launchReady());
  expect(screen.getByTestId('launch-screen', HIDDEN).props.pointerEvents).toBe('auto');

  await wait(LAUNCH_HOLD_MS);
  expect(screen.getByTestId('launch-screen', HIDDEN).props.pointerEvents).toBe('none');
  await wait(1000);
  expect(screen.queryByTestId('launch-screen', HIDDEN)).toBeNull();
});

it('grows the mark a little as it lifts, and with Reduce Motion only fades', async () => {
  const timing = jest.spyOn(Animated, 'timing');
  try {
    render(<LaunchCurtain />);
    expect(styleOf('launch-screen').opacity).toBeDefined();
    const mark = () => styleOf('launch-mark');
    expect(mark().transform).toHaveLength(2);
    screen.unmount();

    resetLaunchForTests();
    jest.mocked(useReduceMotion).mockReturnValue(true);
    timing.mockClear();
    render(<LaunchCurtain />);
    expect(mark().transform).toBeUndefined();
    await act(async () => launchReady());
    await wait(LAUNCH_HOLD_MS);
    // The lift is the short fade, and nothing breathes while waiting.
    const durations = timing.mock.calls.map(([, config]) => (config as { duration?: number }).duration);
    expect(durations).toContain(200);
    expect(durations).not.toContain(900);
  } finally {
    timing.mockRestore();
  }
});
