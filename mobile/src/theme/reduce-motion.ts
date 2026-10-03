import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

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

export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, () => reduced);
}
