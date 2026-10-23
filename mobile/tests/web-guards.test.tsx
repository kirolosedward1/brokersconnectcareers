import { Appearance, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { installCryptoPolyfill } from '~/lib/polyfills';
import { ThemeProvider } from '~/theme/provider';

/*
  The Expo web build. Hermes has no crypto and iOS takes a color scheme;
  the browser already has a read-only crypto, and react-native-web's
  Appearance has no setColorScheme. Either assignment used to stop the
  web bundle before the first screen.
*/

describe('what the web build cannot assign', () => {
  it('leaves a read-only crypto in place and fills one that is missing', () => {
    const crypto = {
      getRandomValues: () => new Uint8Array(),
      randomUUID: () => '00000000-0000-4000-8000-000000000000',
      subtle: { digest: async () => new ArrayBuffer(0) },
    };
    const owned: { crypto?: typeof crypto } = {};
    Object.defineProperty(owned, 'crypto', { value: crypto, writable: false, configurable: false });

    expect(() => installCryptoPolyfill(owned as never)).not.toThrow();
    expect(owned.crypto).toBe(crypto);

    const bare: { crypto?: { getRandomValues?: unknown; randomUUID?: unknown; subtle?: unknown } } = {};
    installCryptoPolyfill(bare as never);
    expect(typeof bare.crypto?.getRandomValues).toBe('function');
    expect(typeof bare.crypto?.randomUUID).toBe('function');
    expect(bare.crypto?.subtle).toBeTruthy();
  });

  it('draws the theme when Appearance has no setColorScheme', () => {
    const appearance = Appearance as { setColorScheme?: (scheme: 'light' | 'dark' | 'unspecified' | null) => void };
    const original = appearance.setColorScheme;
    appearance.setColorScheme = undefined;
    try {
      render(
        <ThemeProvider>
          <Text>theme</Text>
        </ThemeProvider>,
      );
      expect(screen.getByText('theme')).toBeTruthy();
    } finally {
      appearance.setColorScheme = original;
    }
  });

  it('still tells iOS which scheme was chosen', () => {
    const setColorScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
    render(
      <ThemeProvider>
        <Text>theme</Text>
      </ThemeProvider>,
    );
    expect(setColorScheme).toHaveBeenCalledWith('light');
    setColorScheme.mockRestore();
  });
});
