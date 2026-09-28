import { useSyncExternalStore } from 'react';

/**
 * The push somebody tapped, waiting until it is known who is signed in —
 * the same arrangement as open-path.ts, one step earlier: a push names a
 * notification, not a page, and which page it leads to is the website's
 * answer for the person signed in (PushBridge asks it).
 *
 * One at a time: a newer tap replaces one still waiting.
 */
let pending: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function pushTapped(notificationId: string) {
  pending = notificationId;
  emit();
}

/** The tap waiting, taken: it is opened once. */
export function takePushTap(): string | null {
  const id = pending;
  pending = null;
  if (id !== null) emit();
  return id;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => pending;

export function usePushTap(): string | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
