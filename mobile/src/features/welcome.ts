import { useSyncExternalStore } from 'react';

/**
 * The welcome (src/app/welcome.tsx) opens whenever nobody is signed in: at
 * every launch of the app as itself (src/components/navigation/welcome-gate.tsx),
 * and again when the reader signs out. Skipping it closes it until the app is
 * next started; signing in closes it with the sign-in sheet. Nothing about it
 * is kept on the phone.
 */

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
