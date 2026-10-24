import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import { crashReport, forgetCrashLog, forgetLastCrash, installCrashLog, noteFailure, notedFailures, readLastCrash } from '~/lib/crash-log';
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

  it('keeps no address, number, token or file name of anybody’s', async () => {
    noteFailure('apply', new Error('duplicate key for sara.ahmed@example.com, phone +20 100 123 4567, file CV-Sara-Ahmed.pdf'));
    const crash = new Error(
      'request to https://x.supabase.co/storage/v1/object/sign/cvs/u1/cv.pdf?token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXZhbHVl failed for 01001234567',
    );
    current(crash, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const report = crashReport((await readLastCrash())!);
    for (const kept of [notedFailures().join(' '), report]) {
      expect(kept).not.toMatch(/sara\.ahmed|example\.com|1234567|Sara-Ahmed|eyJhbGci|token=/);
    }
    expect(report).toContain('<email>');
    expect(report).toContain('<number>');
  });

  it('forgets everything it holds for a person leaving the phone', async () => {
    noteFailure('apply', 'a failure');
    current(new Error('gone'), true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await forgetCrashLog();
    expect(notedFailures()).toHaveLength(0);
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
    // Pressed again while it is still sliding away: it waits, rather than a sheet that never shows…
    act(() => result.current.show());
    expect(result.current.open).toBe(false);
    // …and opens once iOS says the last one has gone.
    act(() => result.current.onDismiss());
    expect(result.current).toMatchObject({ open: true, mounted: true });
    // Whatever iOS says, it is gone a moment after it closed.
    act(() => result.current.hide());
    act(() => jest.advanceTimersByTime(800));
    expect(result.current.mounted).toBe(false);
    jest.useRealTimers();
  });
});
