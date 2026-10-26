import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ViewStyle } from 'react-native';
import { lifts, palette, shadows, type Colors, type Scheme, type Shadows } from './tokens';

/**
 * Whatever the phone says, light, or dark — the website's three choices. The
 * default is the phone's own setting: someone who runs their iPhone dark, or on
 * Automatic, gets the app dark at night without being asked, as Apple asks of
 * every app (an app-specific appearance setting is a second switch people
 * should not have to find). The website defaults to light; a phone has a
 * setting the browser tab does not. Someone who has already picked one here
 * keeps it — the stored choice is read as before.
 *
 * A fixed choice is also given to iOS (Appearance.setColorScheme), so the parts
 * the app does not draw itself — the tab bar, alerts, the keyboard — match;
 * 'system' hands the decision back ('unspecified').
 */
export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'bc-theme';

type ThemeState = {
  scheme: Scheme;
  colors: Colors;
  /** The scheme's depth: a card's shadow, a raised sheet's, the hero's. */
  shadow: Shadows;
  /** A card's shadow for what repeats down a list (tokens.ts, `lifts`): on an opaque view only. */
  lift: ViewStyle;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark' || stored === 'system') setPreferenceState(stored);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // react-native-web's Appearance has no setColorScheme; calling it crashes
    // the Expo web build. The phone still gets the choice.
    if (typeof Appearance.setColorScheme !== 'function') return;
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }, [preference]);

  const value = useMemo<ThemeState>(() => {
    const scheme: Scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
    return {
      scheme,
      colors: palette[scheme],
      shadow: shadows[scheme],
      lift: lifts[scheme],
      preference,
      setPreference: (next) => {
        setPreferenceState(next);
        AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      },
    };
  }, [preference, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme outside ThemeProvider');
  return value;
}
