import { useCallback, useRef, useSyncExternalStore, type RefObject } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';
import { useScrollToTop } from 'expo-router';

/**
 * Whether the tab bar is drawn small (src/components/navigation/tab-bar.tsx):
 * a size smaller and its icons alone while the reader scrolls down a list, as
 * Instagram's is, and whole again as they scroll back up, reach the top, or
 * another screen comes into view. Every tab stays on it either way.
 */
let small = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setTabBarSmall(next: boolean) {
  if (small === next) return;
  small = next;
  for (const listener of listeners) listener();
}

export function useTabBarSmall(): boolean {
  return useSyncExternalStore(subscribe, () => small);
}

/** This close to its top a list always has the whole bar under it: its first line, give or take. */
const NEAR_TOP = 40;
/** How far a list travels one way before the bar answers: a finger at rest drifts a few points. */
const TRAVEL = 16;

/**
 * For a tab's list, spread onto its ScrollView or FlashList: scrolling down it
 * makes the tab bar small, scrolling back up or reaching its top makes it
 * whole. The bounce past the end of a list is not the reader scrolling back.
 */
export function useShrinkingTabBar() {
  const last = useRef<number | null>(null);
  const goingDown = useRef(true);
  // Where the list was when it last turned: the travel is counted from there.
  const turnedAt = useRef(0);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const y = contentOffset.y;
    if (y <= NEAR_TOP) {
      last.current = y;
      setTabBarSmall(false);
      return;
    }
    if (y > contentSize.height - layoutMeasurement.height) return;
    const before = last.current;
    last.current = y;
    if (before === null || y === before) return;
    const down = y > before;
    if (down !== goingDown.current) {
      goingDown.current = down;
      turnedAt.current = before;
    }
    if (Math.abs(y - turnedAt.current) >= TRAVEL) setTabBarSmall(down);
  }, []);

  return { onScroll, scrollEventThrottle: 16 };
}

/** What can be scrolled back to its top: a ScrollView, a FlashList. */
type Scrollable = Parameters<typeof useScrollToTop>[0] extends RefObject<infer T> ? NonNullable<T> : never;

/**
 * For the list a tab opens on, spread onto it: the shrinking bar, and — the
 * open tab pressed again with this list in view — the list back at its top,
 * as iOS's own tab bar does. (Pressed again further in, the tab's stack goes
 * back to this screen first.)
 */
export function useTabList<T extends Scrollable = ScrollView>() {
  const ref = useRef<T>(null);
  useScrollToTop(ref);
  return { ref, ...useShrinkingTabBar() };
}

/** For tests: the bar whole, as at launch. */
export function resetTabBarForTests() {
  small = false;
}
