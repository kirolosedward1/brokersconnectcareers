import AsyncStorage from '@react-native-async-storage/async-storage';
import { crashReport, forgetLastCrash, installCrashLog, readLastCrash } from '~/lib/crash-log';

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
