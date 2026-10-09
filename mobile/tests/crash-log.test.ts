import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import { crashReport, forgetLastCrash, installCrashLog, readLastCrash } from '~/lib/crash-log';
import { useSheet } from '~/lib/use-sheet';

/*
  An error that closes the app is written down before React Native's own
  handler runs, for the next launch to offer the details to send.
*/

type Handler = (error: unknown, fatal?: boolean) => void;

describe('the crash log', () => {
  const saved = (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
  let current: Handler;
  const previous = jest.fn();

  beforeEach(async () => {
    await AsyncStorage.clear();
    previous.mockReset();
    current = previous;
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = {
      getGlobalHandler: () => current,
      setGlobalHandler: (next: Handler) => {
        current = next;
      },
    };
    installCrashLog();
  });

  afterAll(() => {
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = saved;
  });

  it('keeps what closed the app, and still hands it on', async () => {
    const error = new Error('undefined is not a function');
    current(error, true);
    expect(previous).toHaveBeenCalledWith(error, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const crash = await readLastCrash();
    expect(crash).toMatchObject({ message: 'undefined is not a function', fatal: true });
    expect(crashReport(crash!)).toContain('undefined is not a function');
    await forgetLastCrash();
    expect(await readLastCrash()).toBeNull();
  });

  it('does not keep an error the app went on from', async () => {
    current(new Error('a request failed'), false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await readLastCrash()).toBeNull();
    expect(previous).toHaveBeenCalledTimes(1);
  });
});

describe('a sheet drawn only while it is wanted', () => {
  it('waits out its closing before it opens again, and goes once iOS says it has gone', () => {
    jest.useFakeTimers();
    const { result } = renderHook(() => useSheet());
    act(() => result.current.show());
    expect(result.current).toMatchObject({ open: true, mounted: true });
    act(() => result.current.hide());
    expect(result.current).toMatchObject({ open: false, mounted: true });
    // Pressed again while it is still sliding away: nothing, rather than a sheet that never shows.
    act(() => result.current.show());
    expect(result.current.open).toBe(false);
    act(() => result.current.onDismiss());
    expect(result.current.mounted).toBe(false);
    act(() => result.current.show());
    expect(result.current.open).toBe(true);
    // Whatever iOS says, it is gone a moment after it closed.
    act(() => result.current.hide());
    act(() => jest.advanceTimersByTime(800));
    expect(result.current.mounted).toBe(false);
    jest.useRealTimers();
  });
});
