import type { ReactNode } from 'react';
import { I18nManager, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { DirectionProbe } from '~/components/navigation/direction-probe';
import { I18nProvider } from '~/i18n/provider';
import {
  directionMeasured,
  MEASURE_TIMEOUT_MS,
  RELOADED_AT_KEY,
  resetDirectionForTests,
  useDirectionState,
} from '~/lib/direction';
import { SessionProvider, useSession } from '~/lib/session';
import { ThemeProvider } from '~/theme/provider';
import TabsLayout from '../src/app/(tabs)/_layout';
import { mobileConfig } from './auth-fixtures';
import { fakeServer } from './server';

/*
  Which way the screen was really laid out. Expo Go starts an update it opens
  from the network, or after its own home screen, before it sets the app's
  right to left: the screen came up left to right while the code that asks
  I18nManager read right to left, and the owner's iPhone showed it. The first
  layout is measured, and the app starts again once when it is the wrong way.
  And the tab bar runs the way the screens do, whatever language the phone or
  Expo Go lays native bars out in.
*/

jest.mock('expo-updates', () => ({ reloadAsync: jest.fn(async () => {}), updateId: null }));
// The app as app.config.ts builds it: Arabic only, right to left.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { forcesRTL: true } } },
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
}));
jest.mock('~/lib/session-storage', () => ({
  encryptedSessionStorage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const reload = jest.mocked(Updates.reloadAsync);

beforeEach(async () => {
  resetDirectionForTests();
  reload.mockReset().mockResolvedValue(undefined);
  await AsyncStorage.clear();
});

/** What the root layout reads: the probe, and the state that holds the splash screen and the screens. */
function Shows() {
  return <Text>{useDirectionState()}</Text>;
}

function probe() {
  render(
    <>
      <DirectionProbe />
      <Shows />
    </>,
  );
}

/** The probe's first box laid out at x: 1 when its row ran right to left. */
async function laidOut(x: number) {
  await act(async () => {
    // Never read out, so found among the hidden.
    const first = screen.getByTestId('direction-probe-first', { includeHiddenElements: true });
    fireEvent(first, 'layout', { nativeEvent: { layout: { x, y: 0, width: 1, height: 1 } } });
  });
}

describe('the first layout', () => {
  it('right to left: the app goes on, and nothing starts again', async () => {
    const force = jest.spyOn(I18nManager, 'forceRTL');
    probe();
    expect(screen.getByText('measuring')).toBeTruthy();
    await laidOut(1);
    expect(screen.getByText('settled')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    expect(force).not.toHaveBeenCalled();
    force.mockRestore();
  });

  it('left to right in an app built right to left: the direction is set and the app starts again once', async () => {
    const allow = jest.spyOn(I18nManager, 'allowRTL');
    const force = jest.spyOn(I18nManager, 'forceRTL');
    probe();
    await laidOut(0);
    // Nothing is drawn meanwhile, and the splash screen stays up.
    expect(screen.getByText('reloading')).toBeTruthy();
    expect(allow).toHaveBeenCalledWith(true);
    expect(force).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(Number(await AsyncStorage.getItem(RELOADED_AT_KEY))).toBeGreaterThan(0);
    allow.mockRestore();
    force.mockRestore();
  });

  it('still left to right just after starting again: it carries on as it is instead of starting again for ever', async () => {
    await AsyncStorage.setItem(RELOADED_AT_KEY, String(Date.now() - 2_000));
    probe();
    await laidOut(0);
    expect(screen.getByText('settled')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it('left to right again on a later launch: it starts again once more', async () => {
    await AsyncStorage.setItem(RELOADED_AT_KEY, String(Date.now() - 10 * 60_000));
    probe();
    await laidOut(0);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a start that cannot be made leaves the app as it is, drawn', async () => {
    reload.mockRejectedValueOnce(new Error('ERR_UPDATES_RELOAD'));
    const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    try {
      probe();
      await laidOut(0);
      expect(screen.getByText('settled')).toBeTruthy();
    } finally {
      (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
    }
  });

  it('only the first layout counts: a second one, the other way, changes nothing', async () => {
    probe();
    await laidOut(1);
    await act(async () => {
      await directionMeasured(0);
    });
    expect(screen.getByText('settled')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it('a probe never laid out holds nothing up for long', async () => {
    jest.useFakeTimers();
    try {
      probe();
      expect(screen.getByText('measuring')).toBeTruthy();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(MEASURE_TIMEOUT_MS - 1);
      });
      expect(screen.getByText('measuring')).toBeTruthy();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByText('settled')).toBeTruthy();
      expect(reload).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the tab bar', () => {
  const server = fakeServer();

  beforeAll(() => {
    globalThis.fetch = server.fetch as unknown as typeof fetch;
  });

  beforeEach(() => {
    server.on('GET /api/mobile/v1/config', mobileConfig());
  });

  function Settled({ children }: { children: ReactNode }) {
    return useSession().settled ? children : null;
  }

  function Root() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return (
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <I18nProvider>
            <SessionProvider>
              <Settled>
                <Stack screenOptions={{ headerShown: false }} />
              </Settled>
            </SessionProvider>
          </I18nProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  /** The direction the native tab host was given. */
  function hostDirection(): unknown {
    const hosts = screen.UNSAFE_root.findAll((node) => node.type === ('RNSTabsHostIOS' as unknown as typeof node.type));
    expect(hosts.length).toBeGreaterThan(0);
    return hosts[0].props.layoutDirection;
  }

  it('runs right to left when the screens were laid out right to left, though React Native says otherwise', async () => {
    // As on an iPhone in English: React Native's own answer is left to right.
    expect(I18nManager.isRTL).toBe(false);
    render(<DirectionProbe />);
    await laidOut(1);
    renderRouter(
      {
        _layout: { default: Root, unstable_settings: { anchor: '(tabs)' } },
        '(tabs)/_layout': TabsLayout,
        '(tabs)/(home)/index': () => <Text>home-screen</Text>,
        '(tabs)/(account)/account/index': () => <Text>account</Text>,
      },
      { initialUrl: '/' },
    );
    await screen.findByText('home-screen');
    expect(hostDirection()).toBe('rtl');
  });
});
