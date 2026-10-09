import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { shownToast, toast, ToastHost } from '~/components/feedback/toast';
import { SwipeCard, SWIPE_COMMIT } from '~/components/jobs/swipe-card';
import { Bookmark, EyeOff } from '~/components/ui/lucide';
import { I18nProvider } from '~/i18n/provider';
import { useSheet } from '~/lib/use-sheet';
import { ThemeProvider } from '~/theme/provider';

/*
  The quick ways the owner asked for: a word that something happened (with
  Undo), a card swiped all the way to act on it, and a sheet that does what
  was chosen in it only once it has gone.
*/

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } };

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <I18nProvider>{children}</I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

describe('a toast', () => {
  afterEach(() => act(() => toast.hide()));

  it('says what happened, to VoiceOver too, and offers one thing to do about it', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const undo = jest.fn();
    render(<ToastHost />, { wrapper: Providers });
    act(() => toast.show({ message: 'اتشالت من المحفوظة', action: { label: 'تراجع', onPress: undo } }));

    expect(screen.getByText('اتشالت من المحفوظة')).toBeTruthy();
    expect(announce).toHaveBeenCalledWith('اتشالت من المحفوظة. تراجع');
    fireEvent.press(screen.getByRole('button', { name: 'تراجع' }));
    expect(undo).toHaveBeenCalledTimes(1);
    announce.mockRestore();
  });

  it('gives its place to a newer one, and goes on its own', () => {
    jest.useFakeTimers();
    try {
      render(<ToastHost />, { wrapper: Providers });
      act(() => toast.show({ message: 'واحد' }));
      act(() => toast.show({ message: 'اتنين' }));
      expect(screen.queryByText('واحد')).toBeNull();
      expect(screen.getByText('اتنين')).toBeTruthy();
      act(() => jest.advanceTimersByTime(5000));
      expect(shownToast()).toBeNull();
      expect(screen.queryByText('اتنين')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

/** A drag of `dx` points, as the responder system hands it to the card. */
function drag(target: Parameters<typeof fireEvent>[0], dx: number) {
  const at = (x: number, time: number) => ({
    nativeEvent: { touches: [{ pageX: 100 + x, pageY: 300 }], changedTouches: [{ pageX: 100 + x, pageY: 300 }], pageX: 100 + x, pageY: 300, timestamp: time },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: time,
      touchBank: [
        {
          touchActive: true,
          startPageX: 100,
          startPageY: 300,
          startTimeStamp: 0,
          currentPageX: 100 + x,
          currentPageY: 300,
          currentTimeStamp: time,
          previousPageX: 100,
          previousPageY: 300,
          previousTimeStamp: 0,
        },
      ],
    },
  });
  fireEvent(target, 'responderGrant', at(0, 1));
  fireEvent(target, 'responderMove', at(dx, 50));
  fireEvent(target, 'responderRelease', at(dx, 80));
}

describe('a card swiped all the way', () => {
  const ways = () => ({
    right: { label: 'احفظ', icon: Bookmark, ground: '#eee', ink: '#333', onSwipe: jest.fn() },
    left: { label: 'خبّي', icon: EyeOff, ground: '#ddd', ink: '#333', onSwipe: jest.fn() },
  });
  const card = (way: ReturnType<typeof ways>) =>
    render(
      <SwipeCard right={way.right} left={way.left}>
        <Text>الكارت</Text>
      </SwipeCard>,
      { wrapper: Providers },
    );
  const handle = () => screen.UNSAFE_root.findAll((node) => typeof node.props.onResponderMove === 'function')[0];

  it('does the way it went, past the mark', () => {
    const way = ways();
    card(way);
    drag(handle(), SWIPE_COMMIT + 10);
    expect(way.right.onSwipe).toHaveBeenCalledTimes(1);
    expect(way.left.onSwipe).not.toHaveBeenCalled();
  });

  it('does nothing short of it', () => {
    const way = ways();
    card(way);
    drag(handle(), SWIPE_COMMIT - 30);
    drag(handle(), -(SWIPE_COMMIT - 30));
    expect(way.right.onSwipe).not.toHaveBeenCalled();
    expect(way.left.onSwipe).not.toHaveBeenCalled();
  });

  it('sets aside what leaves the list once it has slid away', () => {
    jest.useFakeTimers();
    try {
      const way = ways();
      card({ ...way, left: { ...way.left, leaves: true } as typeof way.left });
      drag(handle(), -(SWIPE_COMMIT + 10));
      act(() => jest.advanceTimersByTime(400));
      expect(way.left.onSwipe).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('a sheet', () => {
  it('does what was chosen in it once it has gone, and takes a press event for nothing', () => {
    jest.useFakeTimers();
    try {
      const after = jest.fn();
      const { result } = renderHook(() => useSheet());
      act(() => result.current.show());
      // Handed straight to onPress, hide is given the press: nothing to run.
      act(() => result.current.hide({ nativeEvent: {} }));
      act(() => jest.advanceTimersByTime(1000));
      act(() => result.current.show());
      act(() => result.current.hide(after));
      expect(after).not.toHaveBeenCalled();
      act(() => result.current.onDismiss());
      expect(after).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('still does it when it is taken away with its row before it has gone', () => {
    jest.useFakeTimers();
    try {
      const after = jest.fn();
      const { result, unmount } = renderHook(() => useSheet());
      act(() => result.current.show());
      act(() => result.current.hide(after));
      unmount();
      jest.advanceTimersByTime(1000);
      expect(after).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
