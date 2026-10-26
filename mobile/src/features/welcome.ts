import { useEffect, useState, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The welcome (src/app/welcome.tsx) opens with nobody signed in: at the first
 * launch of the app as itself (src/components/navigation/welcome-gate.tsx), and
 * again when the reader signs out. Signing in closes it with the sign-in sheet.
 *
 * Skipping it is remembered on the phone (`bc-welcome-skipped`), so someone
 * who chose to look around without an account is not shown it again at every
 * launch — Apple asks that onboarding not come back on later launches (HIG,
 * Onboarding) — and the Account tab is where they sign in when they want to.
 * Signing out forgets the skip: the welcome is the answer to a sign-out, and
 * the next launch after one opens on it again until it is skipped again.
 */

const SKIPPED = 'bc-welcome-skipped';

/** The reader skipped the welcome: it does not open at the next launch. */
export function rememberWelcomeSkipped() {
  AsyncStorage.setItem(SKIPPED, '1').catch(() => {});
}

/** The reader signed out: the welcome opens again, at once and at the next launch, until it is skipped. */
export function forgetWelcomeSkipped() {
  AsyncStorage.removeItem(SKIPPED).catch(() => {});
}

/**
 * Whether the welcome was skipped on this phone, as it was when the app
 * started: null until the phone has said. A phone that cannot say is taken
 * not to have skipped it.
 */
export function useWelcomeSkipped(): boolean | null {
  const [skipped, setSkipped] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(SKIPPED)
      .then((stored) => stored === '1')
      .catch(() => false)
      .then((known) => {
        if (live) setSkipped(known);
      });
    return () => {
      live = false;
    };
  }, []);
  return skipped;
}

let drawn = false;
let opens = true;
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

/** Whether the welcome opens at all: always in the app; a test of something else turns it off. */
export function welcomeOpens(): boolean {
  return opens;
}

/** For tests: a fresh launch, with the welcome opening as it does in the app or, `false`, never. */
export function resetWelcomeForTests(open = true) {
  drawn = false;
  opens = open;
}
