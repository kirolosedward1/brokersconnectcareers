import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance } from 'react-native';
import { useNavigation, useScrollToTop } from 'expo-router';

/*
 * The tab bar keeps its size and its names however a list scrolls
 * (src/components/navigation/tab-bar.tsx). It used to grow smaller and drop
 * its names while the reader scrolled down, as Instagram's does; Apple asks
 * for a tab bar whose labels are always there to read (HIG, Tab bars:
 * "Include tab labels"), and a bar that changes size under the thumb is one
 * more thing on the screen moving.
 */

/** This close to its top a list counts as at its top: its first line, give or take. */
const NEAR_TOP = 40;

/** What can be scrolled back to its top: a ScrollView, a FlashList. */
type Scrollable = Parameters<typeof useScrollToTop>[0] extends RefObject<infer T> ? NonNullable<T> : never;

/**
 * For the list a tab opens on, spread onto it: the open tab pressed again with
 * this list in view brings the list back to its top, as iOS's own tab bar
 * does. (Pressed again further in, the tab's stack goes back to this screen
 * first.) Pressed again with the list already at its
 * top, `onPressAtTop` — the board puts the cursor in its search field.
 */
export function useTabList<T extends Scrollable = ScrollViewInstance>({ onPressAtTop }: { onPressAtTop?: () => void } = {}) {
  const ref = useRef<T>(null);
  useScrollToTop(ref);
  // Where the list is, read when the tab is pressed: null until it first moves (at its top).
  const y = useRef<number | null>(null);
  // A new list put in its place (the board read afresh) starts at its top, without a scroll to say so.
  const attach = useCallback((node: T | null) => {
    ref.current = node;
    y.current = null;
  }, []);
  const navigation = useNavigation();
  const latest = useRef(onPressAtTop);
  useEffect(() => {
    latest.current = onPressAtTop;
  });

  // Pressed again with the list already at its top (useScrollToTop has nothing left to do): `onPressAtTop`.
  useEffect(() => {
    const pressed = () => {
      if (!latest.current || !navigation.isFocused() || (y.current ?? 0) > NEAR_TOP) return;
      // After the press has done its own work (the stack and the list are where they go).
      requestAnimationFrame(() => latest.current?.());
    };
    // Heard on every screen up the chain, as useScrollToTop does: only the tab's own
    // screen is told of a press. The tabs cannot be picked out by their state here,
    // which says it is the tabs only once they have handled an action — not yet when
    // the app opens straight onto this list.
    const stops: (() => void)[] = [];
    for (let screen: typeof navigation | undefined = navigation; screen; screen = screen.getParent()) {
      stops.push(screen.addListener('tabPress' as never, pressed));
    }
    return () => stops.forEach((stop) => stop());
  }, [navigation]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    y.current = event.nativeEvent.contentOffset.y;
  }, []);

  return { ref: attach, onScroll, scrollEventThrottle: 16 };
}
