import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Whether the welcome has had its answer on this phone: the reader chose to
 * look around without an account, or signed in. Until then, a signed-out
 * launch opens on it (src/app/welcome.tsx, src/components/navigation/welcome-gate.tsx);
 * after, never again — signing out later leads to Account's own sign-in.
 *
 * `unknown` until the phone has answered; a phone that cannot answer counts
 * as answered, so a storage failure never shows the welcome on every launch.
 */
export const WELCOME_KEY = 'bc.welcome.v1';

export type WelcomeState = 'unknown' | 'due' | 'done';

let state: WelcomeState = 'unknown';
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function load(): Promise<void> {
  loading ??= AsyncStorage.getItem(WELCOME_KEY)
    .then((stored) => {
      if (state === 'unknown') state = stored === 'done' ? 'done' : 'due';
    })
    .catch(() => {
      if (state === 'unknown') state = 'done';
    })
    .finally(emit);
  return loading;
}

export function useWelcomeState(): WelcomeState {
  useEffect(() => {
    void load();
  }, []);
  return useSyncExternalStore(subscribe, () => state);
}

/** The welcome has its answer: kept, so it is not asked again. */
export function welcomeAnswered() {
  if (state !== 'done') {
    state = 'done';
    emit();
  }
  AsyncStorage.setItem(WELCOME_KEY, 'done').catch(() => {});
}

let drawn = false;

/** The welcome is on screen: the splash screen can come down onto it (the root layout). */
export function welcomeDrawn() {
  if (!drawn) {
    drawn = true;
    emit();
  }
}

export function useWelcomeDrawn(): boolean {
  return useSyncExternalStore(subscribe, () => drawn);
}

/** For tests: the state a fresh install has. */
export function resetWelcomeForTests() {
  state = 'unknown';
  loading = null;
  drawn = false;
}
