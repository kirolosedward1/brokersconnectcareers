import { Linking, Platform, ScrollView, Text, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { UpdateGate } from '~/components/navigation/update-gate';
import { useHoldsWork } from '~/lib/use-leave-guard';
import { isOlderThan } from '~/features/update';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { ThemeProvider } from '~/theme/provider';
import { mobileConfig } from './auth-fixtures';
import { fakeServer } from './server';

/*
  The oldest build the website still serves: below it, one screen asking for
  an update (and the way to the App Store once there is one); at it or above,
  or when the answer cannot be had, the app as usual. This build is 1.0.0
  (tests/setup.ts).
*/

const ar = catalogues.ar;
const server = fakeServer();

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

/** Long enough for the answer to arrive and be drawn: the gate decides on it, not on the asking. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

function gate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <I18nProvider>
          <UpdateGate>
            <Text>the app</Text>
          </UpdateGate>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('versions', () => {
  it.each([
    ['1.0.0', '1.0.1', true],
    ['1.0.0', '1.1', true],
    ['1.9.9', '1.10.0', true],
    ['1.10.0', '1.9.9', false],
    ['1.0', '1.0.0', false],
    ['2', '1.9.9', false],
    ['1.0.0', '1.0.0', false],
  ])('%s is older than %s: %s', (version, minimum, older) => {
    expect(isOlderThan(version, minimum)).toBe(older);
  });
});

describe('the gate', () => {
  it('asks for an update below the version the website still serves, with the way to the App Store', async () => {
    const url = 'https://apps.apple.com/app/brokers-connect/id000000000';
    server.on('GET /api/mobile/v1/config', mobileConfig({ minAppVersion: '1.2.0', appStoreUrl: url }));
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    gate();

    expect(await screen.findByText(ar.app.update.title)).toBeTruthy();
    expect(screen.queryByText('the app')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: ar.app.update.cta }));
    expect(openURL).toHaveBeenCalledWith(url);
    openURL.mockRestore();
  });

  it('scrolls to the button under its words, clear of the status bar, only when they are taller than the screen', async () => {
    const url = 'https://apps.apple.com/app/brokers-connect/id000000000';
    server.on('GET /api/mobile/v1/config', mobileConfig({ minAppVersion: '1.2.0', appStoreUrl: url }));
    gate();
    expect(await screen.findByText(ar.app.update.title)).toBeTruthy();
    // React Native's stand-ins measure nothing: the gate fills the screen.
    const inWindow = jest
      .spyOn(ScrollView.prototype as unknown as { measureInWindow: (...args: unknown[]) => void }, 'measureInWindow')
      .mockImplementation((done: unknown) => (done as (x: number, y: number, w: number, h: number) => void)(0, 0, 393, 852));
    const laidOut = (words: number) => {
      const scroll = screen.UNSAFE_getByType(ScrollView);
      fireEvent(scroll, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 393, height: 852 } } });
      const content = within(scroll)
        .UNSAFE_getAllByType(View)
        .find((view) => typeof view.props.onLayout === 'function');
      if (!content) throw new Error('the words are not measured');
      fireEvent(content, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 345, height: words } } });
      return screen.UNSAFE_getByType(ScrollView);
    };

    // As it usually is: still, in the middle, nothing to drag.
    let scroll = laidOut(240);
    expect(scroll.props.contentInsetAdjustmentBehavior).toBe('scrollableAxes');
    expect(scroll.props.alwaysBounceVertical).toBe(false);

    // At the largest text sizes: taller than the screen, so it scrolls, inset from the bars.
    scroll = laidOut(900);
    expect(scroll.props.alwaysBounceVertical).toBe(true);
    expect(within(scroll).getByRole('button', { name: ar.app.update.cta })).toBeTruthy();
    inWindow.mockReset();
  });

  it('waits while a screen holds typed work, which it would otherwise throw away, and asks once it is let go', async () => {
    server.on('GET /api/mobile/v1/config', mobileConfig({ minAppVersion: '1.2.0' }));
    // Half a listing typed when the website, read again on coming back to the app, starts asking for 1.2.0.
    function Typing({ holding }: { holding: boolean }) {
      useHoldsWork(holding);
      return <Text>half a listing</Text>;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const tree = (holding: boolean) => (
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <I18nProvider>
            <UpdateGate>
              <Typing holding={holding} />
            </UpdateGate>
          </I18nProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(tree(true));
    await settle();
    expect(screen.getByText('half a listing')).toBeTruthy();
    expect(screen.queryByText(ar.app.update.title)).toBeNull();

    // Saved, or thrown away on purpose: now the update is asked for.
    rerender(tree(false));
    expect(await screen.findByText(ar.app.update.title)).toBeTruthy();
  });

  it('offers no button before the app is listed', async () => {
    server.on('GET /api/mobile/v1/config', mobileConfig({ minAppVersion: '1.2.0' }));
    gate();
    expect(await screen.findByText(ar.app.update.body)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.app.update.cta })).toBeNull();
  });

  it('lets the app through at the version the website asks for', async () => {
    server.on('GET /api/mobile/v1/config', mobileConfig({ minAppVersion: '1.0.0' }));
    gate();
    await waitFor(() => expect(server.asked('/api/mobile/v1/config').length).toBeGreaterThan(0));
    await settle();
    expect(screen.getByText('the app')).toBeTruthy();
    expect(screen.queryByText(ar.app.update.title)).toBeNull();
  });

  it('holds Android to its own floor, and leads to the Play Store rather than the App Store', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    const play = 'https://play.google.com/store/apps/details?id=net.brokersconnect.app';
    server.on(
      'GET /api/mobile/v1/config',
      mobileConfig({
        minAppVersion: '1.0.0',
        appStoreUrl: 'https://apps.apple.com/app/brokers-connect/id000000000',
        minAndroidAppVersion: '1.3.0',
        playStoreUrl: play,
      }),
    );
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    try {
      gate();
      expect(await screen.findByText(ar.app.update.title)).toBeTruthy();
      fireEvent.press(screen.getByRole('button', { name: ar.app.update.cta }));
      expect(openURL).toHaveBeenCalledWith(play);
    } finally {
      openURL.mockRestore();
      os.restore();
    }
  });

  it("does not hold an iPhone to Android's floor", async () => {
    server.on('GET /api/mobile/v1/config', mobileConfig({ minAppVersion: '1.0.0', minAndroidAppVersion: '1.3.0' }));
    gate();
    await waitFor(() => expect(server.asked('/api/mobile/v1/config').length).toBeGreaterThan(0));
    await settle();
    expect(screen.getByText('the app')).toBeTruthy();
  });

  it('never locks anybody out because the question could not be asked', async () => {
    server.on('GET /api/mobile/v1/config', { status: 503, body: { error: 'unavailable' } });
    gate();
    await waitFor(() => expect(server.asked('/api/mobile/v1/config').length).toBeGreaterThan(0));
    await settle();
    expect(screen.getByText('the app')).toBeTruthy();
  });
});
