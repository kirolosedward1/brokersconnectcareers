import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { palette, type Colors, type Scheme } from './tokens';

/**
 * Light, dark, or whatever the phone says — the website's three choices, with
 * the website's default: light, until the person picks otherwise.
 *
 * The choice is also given to iOS (Appearance.setColorScheme), so the parts
 * the app does not draw itself — the tab bar, alerts, the keyboard — match.
 */
export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'bc-theme';

type ThemeState = {
  scheme: Scheme;
  colors: Colors;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('light');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark' || stored === 'system') setPreferenceState(stored);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }, [preference]);

  const value = useMemo<ThemeState>(() => {
    const scheme: Scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
    return {
      scheme,
      colors: palette[scheme],
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
