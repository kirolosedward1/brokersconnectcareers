import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the phone asks for less transparency (Settings → Accessibility →
 * Display & Text Size → Reduce Transparency), kept current: glass gives way to
 * a solid surface then. One subscription for the whole app, started by the
 * first thing that asks.
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
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then(set)
      .catch(() => {});
    AccessibilityInfo.addEventListener('reduceTransparencyChanged', set);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReduceTransparency(): boolean {
  return useSyncExternalStore(subscribe, () => reduced);
}
