import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * How this phone draws the app, beyond light or dark (ThemeProvider): the
 * digits numbers are written in, whether the phone taps back, and whether the
 * app moves less than the phone's own setting asks. Kept on the phone only —
 * none of it is the person's account, and a second phone starts from the
 * defaults.
 *
 * Western digits are the default because they are the website's (format.ts)
 * and what listings, prices and phone numbers are written in across Egypt's
 * property market; Arabic-Indic digits are offered for those who read them
 * more easily. Only the drawing changes: what is stored, sent and compared is
 * the same number.
 */
export type Numerals = 'latn' | 'arab';

export type AppPreferences = {
  numerals: Numerals;
  /** The phone's taps back (haptics.ts). iOS's own System Haptics switch still wins when it is off. */
  haptics: boolean;
  /** Less motion than the phone asks for: true reduces it here even when the phone does not. */
  reduceMotion: boolean;
};

export const DEFAULT_PREFERENCES: AppPreferences = {
  numerals: 'latn',
  haptics: true,
  reduceMotion: false,
};

const STORAGE_KEY = 'bc.app-preferences.v1';

let current: AppPreferences = DEFAULT_PREFERENCES;
let loaded = false;
const listeners = new Set<() => void>();

function publish(next: AppPreferences) {
  current = next;
  listeners.forEach((listener) => listener());
}

function read(stored: string | null): AppPreferences {
  if (!stored) return DEFAULT_PREFERENCES;
  try {
    const raw = JSON.parse(stored) as Partial<Record<keyof AppPreferences, unknown>>;
    return {
      numerals: raw.numerals === 'arab' ? 'arab' : 'latn',
      haptics: raw.haptics !== false,
      reduceMotion: raw.reduceMotion === true,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** Reads what this phone keeps, once; drawn with the defaults until it arrives. */
export function loadAppPreferences(): Promise<void> {
  if (loaded) return Promise.resolve();
  loaded = true;
  return AsyncStorage.getItem(STORAGE_KEY)
    .then((stored) => publish(read(stored)))
    .catch(() => {});
}

export function setAppPreference<K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) {
  loaded = true;
  const next = { ...current, [key]: value };
  publish(next);
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
}

/** The preferences as they stand, for code outside a component (the in-sentence number tag, haptics). */
export function appPreferences(): AppPreferences {
  return current;
}

function subscribe(listener: () => void) {
  void loadAppPreferences();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAppPreferences(): AppPreferences {
  return useSyncExternalStore(subscribe, () => current);
}

/** For tests: back to the defaults, unread. */
export function resetAppPreferencesForTests() {
  loaded = false;
  current = DEFAULT_PREFERENCES;
}

const ARABIC_INDIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/**
 * Western digits written as the chosen numerals: Arabic-Indic for 'arab' in an
 * Arabic sentence, as they are otherwise. The grouping comma becomes the
 * Arabic thousands separator and the decimal point the Arabic decimal mark,
 * so "12,500.5" reads «١٢٬٥٠٠٫٥».
 */
export function toNumerals(text: string, numerals: Numerals, locale: string): string {
  if (numerals !== 'arab' || !locale.startsWith('ar')) return text;
  return text
    .replace(/(\d)([,.])(?=\d)/g, (_, digit: string, mark: string) => `${digit}${mark === ',' ? '٬' : '٫'}`)
    .replace(/\d/g, (digit) => ARABIC_INDIC[Number(digit)]!);
}
