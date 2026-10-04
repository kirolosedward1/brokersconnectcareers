import { useSyncExternalStore } from 'react';
import { DevSettings, I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

/**
 * Right to left as the screen was really laid out, not as I18nManager says.
 *
 * The app is Arabic only and forces right to left (app.config.ts,
 * `forcesRTL`). React Native fixes a screen's direction once, when the screen
 * is created, from the setting as it stands at that moment. Expo Go creates
 * it before it applies the app's `forcesRTL` whenever it opens an update from
 * the network or comes back from its own home screen, which sets the
 * direction back to its own: it starts the app as soon as the manifest has
 * arrived and sets the direction only once the bundle has (SDK 57's
 * EXAppViewController). So the app came up laid out left to right while every
 * piece of code that asks I18nManager.isRTL — the chevrons, the headers, the
 * fields, the native stacks — read right to left against it.
 *
 * So the first layout is measured: of two one-point boxes in a row two points
 * wide, the first sits on the right when the row runs right to left. When the
 * layout is not the direction the app is meant to have, the direction is set
 * and the app starts again once — in Expo Go from its cache, which sets the
 * direction before the screen is created. Started again a moment ago and
 * still wrong, it carries on as it is rather than start again for ever.
 *
 * `measuring` until the first layout, `settled` after it (or when nothing can
 * be measured), `reloading` while the app is about to start again: nothing is
 * drawn then, and the splash screen stays up.
 */
export type DirectionState = 'measuring' | 'settled' | 'reloading';

/** When the app last started again for its direction; within this, it does not again. */
export const RELOADED_AT_KEY = 'bc.direction-reloaded-at';
const AGAIN_AFTER_MS = 20_000;
/** A probe that has not been laid out by then is not going to be: carry on. */
export const MEASURE_TIMEOUT_MS = 1_500;

let state: DirectionState = 'measuring';
let measured: boolean | null = null;
const listeners = new Set<() => void>();

function set(next: DirectionState) {
  if (state === next) return;
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDirectionState(): DirectionState {
  return useSyncExternalStore(subscribe, () => state);
}

/** The direction the screen was laid out in, once measured; until then, what React Native says. */
export function useLayoutDirection(): 'rtl' | 'ltr' {
  useSyncExternalStore(subscribe, () => state);
  return (measured ?? I18nManager.isRTL) ? 'rtl' : 'ltr';
}

/** Right to left is what the app is built for while it is Arabic only, or what the phone's language asks for. */
function intendedRTL(): boolean {
  return Constants.expoConfig?.extra?.forcesRTL === true || I18nManager.isRTL;
}

/** Nothing measured in time: the app goes on as it is. */
export function directionUnmeasured() {
  if (state === 'measuring') set('settled');
}

/**
 * The probe's first box, laid out at `x` in its two-point row: 1 when the row
 * runs right to left. Only the first answer counts.
 */
export async function directionMeasured(x: number): Promise<void> {
  if (state !== 'measuring') return;
  const rightToLeft = x > 0;
  measured = rightToLeft;
  const intended = intendedRTL();
  if (rightToLeft === intended) return set('settled');

  set('reloading');
  try {
    const last = Number(await AsyncStorage.getItem(RELOADED_AT_KEY));
    // Started again a moment ago and still the wrong way: not again.
    if (last && Date.now() - last < AGAIN_AFTER_MS) return set('settled');
    // A start whose time could not be kept is not made: it could be made for ever.
    await AsyncStorage.setItem(RELOADED_AT_KEY, String(Date.now()));
  } catch {
    return set('settled');
  }

  I18nManager.allowRTL(intended);
  I18nManager.forceRTL(intended);
  try {
    await Updates.reloadAsync();
  } catch {
    // Served by a development server, which Updates cannot reload.
    if (__DEV__) DevSettings.reload();
    else set('settled');
  }
}

/** For tests: the state a fresh start has. */
export function resetDirectionForTests() {
  state = 'measuring';
  measured = null;
}
