import { Animated, StyleSheet } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { LAUNCH_MARK_WIDTH, LAUNCH_WORDMARK_HEIGHT, welcomeTile, welcomeWordmarkHeight } from '~/components/brand/launch-size';
import { BREATHE_AFTER_MS, LaunchCurtain } from '~/components/brand/launch-screen';
import { LAUNCH_HOLD_MS, launchReady, resetLaunchForTests } from '~/features/launch';
import { useReduceMotion } from '~/theme/reduce-motion';

/** The curtain is hidden from VoiceOver, so queries have to be told to look at it. */
const HIDDEN = { includeHiddenElements: true };

// The tests' types are Jest's alone, so the little of Node used here is typed where it is used.
declare const __dirname: string;
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs');
const { join } = jest.requireActual<{ join: (...parts: string[]) => string }>('path');

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

it('draws the mark at the splash width, and the wordmark in the artwork\'s proportion', () => {
  render(<LaunchCurtain />);
  const mark = StyleSheet.flatten(screen.getByTestId('launch-mark-image', HIDDEN).props.style);
  const word = StyleSheet.flatten(screen.getByTestId('launch-wordmark', HIDDEN).props.style);
  // A little under three fifths of the previous 76-point mark, and the same share of the wordmark.
  expect(LAUNCH_MARK_WIDTH).toBe(44);
  expect(LAUNCH_WORDMARK_HEIGHT).toBe(12);
  expect(mark).toMatchObject({ width: LAUNCH_MARK_WIDTH, height: LAUNCH_MARK_WIDTH });
  expect(word).toMatchObject({ width: (1375 / 286) * LAUNCH_WORDMARK_HEIGHT, height: LAUNCH_WORDMARK_HEIGHT });

  // The welcome lockup is that same share of its previous tile (52 / 44) and wordmark (26 / 22).
  expect(welcomeTile(false)).toBe(30);
  expect(welcomeTile(true)).toBe(25);
  expect(welcomeWordmarkHeight(false)).toBe(15);
  expect(welcomeWordmarkHeight(true)).toBe(13);

  // The native splash is given that same width, so the handoff does not jump.
  const config = readFileSync(join(__dirname, '../app.config.ts'), 'utf8');
  expect(config).toContain('imageWidth: LAUNCH_MARK_WIDTH');
});

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
  // Not before its moment is up…
  await wait(LAUNCH_HOLD_MS - 100);
  expect(screen.getByTestId('launch-screen', HIDDEN).props.pointerEvents).toBe('auto');
  // …and lifting just after.
  await wait(150);
  expect(screen.getByTestId('launch-screen', HIDDEN).props.pointerEvents).toBe('none');
  await wait(1000);
  expect(screen.queryByTestId('launch-screen', HIDDEN)).toBeNull();
});

it('breathes on a slow start, and with Reduce Motion on neither breathes nor grows: it only fades', async () => {
  const timing = jest.spyOn(Animated, 'timing');
  const durations = () => timing.mock.calls.map(([, config]) => (config as { duration?: number }).duration);
  try {
    render(<LaunchCurtain />);
    const mark = () => styleOf('launch-mark');
    expect(mark().transform).toHaveLength(2);
    // Still getting ready well past its moment: the mark breathes.
    await wait(BREATHE_AFTER_MS + 100);
    expect(durations()).toContain(900);
    screen.unmount();

    resetLaunchForTests();
    jest.mocked(useReduceMotion).mockReturnValue(true);
    timing.mockClear();
    render(<LaunchCurtain />);
    expect(mark().transform).toBeUndefined();
    await wait(BREATHE_AFTER_MS + 100);
    expect(durations()).not.toContain(900);
    await act(async () => launchReady());
    await wait(100);
    // The lift is the short fade.
    expect(durations()).toContain(200);
  } finally {
    timing.mockRestore();
  }
});
