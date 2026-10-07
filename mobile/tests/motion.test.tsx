import type { ReactNode } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Appear, travelFrom } from '~/components/motion/appear';
import { Float } from '~/components/motion/float';
import { Pop } from '~/components/motion/pop';
import { ProgressBar } from '~/components/motion/progress-bar';
import { Pulse } from '~/components/motion/pulse';
import { I18nProvider } from '~/i18n/provider';
import { useReduceMotion } from '~/theme/reduce-motion';
import { ThemeProvider } from '~/theme/provider';
import { motion } from '~/theme/tokens';

/*
  The app's motion: what arrives fades in as it travels its last few points,
  from the side the reading starts or ends on (in Arabic, the right and the
  left); a flow's progress grows from the start side; drawings drift; a
  bookmark the reader saves pops. Only how things look changes — what is on
  the screen is there, laid out and read by VoiceOver, from the first frame —
  and nothing runs on after its screen.

  Animations on the native thread finish there; a test sees what was asked of
  them (Animated.timing's settings) and what is drawn before the first frame.
*/

jest.mock('~/lib/direction', () => ({ appDirection: 'rtl' }));
jest.mock('~/theme/reduce-motion', () => ({ useReduceMotion: jest.fn(() => false) }));

function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>{children}</I18nProvider>
    </ThemeProvider>
  );
}

type Drawn = { opacity?: unknown; transform?: { translateX?: unknown; translateY?: unknown }[] };
const drawn = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style) as Drawn;
/** A number as drawn: Animated hands the view the animated value's number of the moment. */
const valueOf = (value: unknown) =>
  typeof value === 'number' ? value : (value as { __getValue(): number }).__getValue();

let timing: jest.SpyInstance;
beforeEach(() => {
  jest.mocked(useReduceMotion).mockReturnValue(false);
  timing = jest.spyOn(Animated, 'timing');
});
afterEach(() => timing.mockRestore());

describe('arriving', () => {
  it('is on the screen, to be read, from the first frame, faded out and a little below where it belongs', () => {
    render(
      <Appear testID="arriving" delay={motion.stagger * 2}>
        <Text>مرحباً</Text>
      </Appear>,
      { wrapper: Providers },
    );
    expect(screen.getByText('مرحباً')).toBeTruthy();
    const style = drawn('arriving');
    expect(valueOf(style.opacity)).toBe(0);
    expect(valueOf(style.transform?.[0]?.translateY)).toBe(motion.appearDistance);
    // …and on its way, on the native thread, after its turn.
    expect(timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: 1, delay: motion.stagger * 2, duration: motion.appear, useNativeDriver: true }),
    );
  });

  it('waits for its turn: nothing starts under the splash screen', () => {
    const view = render(<Appear testID="held" play={false} />, { wrapper: Providers });
    expect(timing).not.toHaveBeenCalled();
    view.rerender(<Appear testID="held" play />);
    expect(timing).toHaveBeenCalledTimes(1);
  });

  it('comes in from the side the reading starts or ends on: in Arabic, the right and the left', () => {
    // Transforms are physical: a positive offset is to the right.
    expect(travelFrom('start', 20)).toBe(20);
    expect(travelFrom('end', 20)).toBe(-20);
    expect(travelFrom('below', 20)).toBe(20);
    expect(travelFrom('none', 20)).toBe(0);

    render(<Appear testID="next-step" from="end" distance={24} />, { wrapper: Providers });
    expect(valueOf(drawn('next-step').transform?.[0]?.translateX)).toBe(-24);
  });

  it('only fades, quickly and without travelling, when the phone asks for reduced motion', () => {
    jest.mocked(useReduceMotion).mockReturnValue(true);
    render(<Appear testID="still" delay={300} from="end" />, { wrapper: Providers });
    expect(drawn('still').transform).toBeUndefined();
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ delay: 0, duration: motion.fade }));
  });
});

describe("a flow's progress", () => {
  it('says to VoiceOver which step it is at, and how far that is', () => {
    render(<ProgressBar value={0.5} label="خطوة 2 من 4" />, { wrapper: Providers });
    const bar = screen.getByRole('progressbar', { name: 'خطوة 2 من 4' });
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 50 });
  });

  it('grows from the side the reading starts on: what is not yet done waits past the right edge, in Arabic', () => {
    render(<ProgressBar value={0.25} label="خطوة 1 من 4" />, { wrapper: Providers });
    const bar = screen.getByRole('progressbar');
    // Nothing to slide before the track's length is known.
    expect(bar.props.children).toBeFalsy();
    fireEvent(bar, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 6 } } });
    const fill = screen.getByRole('progressbar').props.children;
    const style = StyleSheet.flatten(fill.props.style) as Drawn & { width?: number };
    expect(style.width).toBe(300);
    // At the start of its way, the whole fill is past the start edge: the right.
    expect(valueOf(style.transform?.[0]?.translateX)).toBe(300);
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 0.25, useNativeDriver: true }));
  });
});

describe('a drawing that drifts', () => {
  it('drifts a few times, then rests: the screen settles', () => {
    const loop = jest.spyOn(Animated, 'loop');
    try {
      render(
        <Float phase={200}>
          <Text>يطفو</Text>
        </Float>,
        { wrapper: Providers },
      );
      expect(loop).toHaveBeenCalledWith(expect.anything(), { iterations: 2 });
      expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ useNativeDriver: true }));
    } finally {
      loop.mockRestore();
    }
  });

  it('stays still with reduced motion asked for', () => {
    jest.mocked(useReduceMotion).mockReturnValue(true);
    render(
      <Float phase={200}>
        <Text>يطفو</Text>
      </Float>,
      { wrapper: Providers },
    );
    expect(timing).not.toHaveBeenCalled();
  });
});

describe('a mark that answers a tap', () => {
  it("pops when the reader's tap saves, and never by itself", () => {
    const view = render(
      <Pop trigger={0}>
        <Text>★</Text>
      </Pop>,
      { wrapper: Providers },
    );
    // Drawn again with nothing tapped — the bookmarks read at launch, a list's
    // row handed to a listing saved last week: still.
    view.rerender(
      <Pop trigger={0}>
        <Text>★</Text>
      </Pop>,
    );
    expect(timing).not.toHaveBeenCalled();

    view.rerender(
      <Pop trigger={1}>
        <Text>★</Text>
      </Pop>,
    );
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1.28, useNativeDriver: true }));
  });

  it('is never left swollen: stopped part-way, it is put back at its own size', () => {
    const view = render(<Pop trigger={0} />, { wrapper: Providers });
    view.rerender(<Pop trigger={1} />);
    const scale = timing.mock.calls[0][0] as Animated.Value & { __getValue(): number };
    // Swollen, half-way through on the native thread, when its row goes.
    act(() => scale.setValue(1.2));
    view.unmount();
    expect(scale.__getValue()).toBe(1);
  });

  it('stays still with reduced motion asked for', () => {
    jest.mocked(useReduceMotion).mockReturnValue(true);
    const view = render(<Pop trigger={0} />, { wrapper: Providers });
    view.rerender(<Pop trigger={1} />);
    expect(timing).not.toHaveBeenCalled();
  });
});

describe('time passing', () => {
  function Moving() {
    return (
      <>
        <Appear testID="arriving" delay={motion.stagger} />
        <Float phase={300}>
          <Text>يطفو</Text>
        </Float>
        <Pulse phase={140} />
        <ProgressBar value={0.75} label="خطوة 3 من 4" />
      </>
    );
  }

  // A screen's motion runs on frames; with the clock faked, a frame that never
  // moved time on would run for ever and hang the test that drew it.
  it('lets a faked clock run on, and leaves nothing behind with its screen', async () => {
    jest.useFakeTimers();
    try {
      const view = render(<Moving />, { wrapper: Providers });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });
      view.unmount();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1_000);
      });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('takes its waiting turns with it when its screen goes before they come', async () => {
    jest.useFakeTimers();
    try {
      const view = render(<Moving />, { wrapper: Providers });
      // Before the first turn (Appear's, at a stagger) has come.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(motion.stagger / 2);
      });
      view.unmount();
      // A frame for React Native's own work; the turns still to come were further off.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(16);
      });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
