import { useSyncExternalStore } from 'react';

/**
 * A page to open as soon as the app knows who it is opening it for.
 *
 * Right after a sign-in the account's profile has only just been read, and
 * the screens that depend on it — the tab bar among them — have not been drawn
 * for it yet: opening a candidate's applications that instant would ask for a
 * tab the bar does not have. So the page waits here, and PendingPath (in the
 * root layout) opens it once the session has settled, deciding with the same
 * rules as every other link (routeInside in links.ts).
 *
 * One page at a time: a newer request replaces an older one still waiting.
 */
let pending: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** A website path, as a sign-in's `next` or a notification's `href` carries it. */
export function openWhenReady(path: string) {
  pending = path;
  emit();
}

/** The page waiting, taken: it is opened once. */
export function takePendingPath(): string | null {
  const path = pending;
  pending = null;
  if (path !== null) emit();
  return path;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => pending;

export function usePendingPath(): string | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
