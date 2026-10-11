import { useSyncExternalStore } from 'react';

/**
 * The launch curtain's two conditions (src/components/brand/launch-screen.tsx).
 *
 * Held: the curtain has been up a moment since the app's code started — long
 * enough to be seen as the app's opening rather than a flicker, short enough
 * never to be waited on. Nothing opens over it before then (the welcome waits
 * for it, src/components/navigation/welcome-gate.tsx).
 *
 * Ready: the first screen of this launch is drawn — the font, the session and
 * the hidden lists known, and the screen the launch opens on up (Home, or the
 * welcome, drawn): the root layout says so. The curtain lifts once both are.
 */

/** When the app's code started. */
const STARTED_AT = Date.now();
/** How long the curtain is up at least, from then. */
export const LAUNCH_HOLD_MS = 900;

let held = false;
let holding: ReturnType<typeof setTimeout> | null = null;
let ready = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!held && !holding) {
    holding = setTimeout(
      () => {
        held = true;
        emit();
      },
      Math.max(0, LAUNCH_HOLD_MS - (Date.now() - STARTED_AT)),
    );
  }
  return () => {
    listeners.delete(listener);
  };
}

export function useLaunchHeld(): boolean {
  return useSyncExternalStore(subscribe, () => held);
}

export function launchReady() {
  if (ready) return;
  ready = true;
  emit();
}

export function useLaunchReady(): boolean {
  return useSyncExternalStore(subscribe, () => ready);
}

/** For tests: a fresh launch, the curtain down again. */
export function resetLaunchForTests() {
  if (holding) clearTimeout(holding);
  holding = null;
  held = false;
  ready = false;
}
