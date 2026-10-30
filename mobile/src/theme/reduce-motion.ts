import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useAppPreferences } from '~/features/preferences/app-preferences';

/**
 * Whether the phone asks for reduced motion (Settings → Accessibility →
 * Motion), kept current. One subscription for the whole app, however many
 * pressable things are on the screen, started by the first one drawn.
 */
let reduced = false;
let started = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (next === reduced) return;
  reduced = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  if (!started) {
    started = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(set)
      .catch(() => {});
    AccessibilityInfo.addEventListener('reduceMotionChanged', set);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The phone's own setting alone: the app's switch shows it, and cannot turn it off. */
export function usePhoneReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, () => reduced);
}

/** The phone's setting, or the app's own (Account → Appearance) when that asks for less. */
export function useReduceMotion(): boolean {
  const phone = usePhoneReduceMotion();
  const { reduceMotion } = useAppPreferences();
  return phone || reduceMotion;
}
