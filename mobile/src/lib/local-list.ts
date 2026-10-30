import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

type Kept<T> = {
  items: readonly T[];
  loaded: boolean;
  loading: Promise<void> | null;
  listeners: Set<() => void>;
};

/** Every list made here, to let go of what each holds in memory for a person (forgetPerson). */
const lists = new Set<{ forget: (owner: string) => void }>();
/**
 * The people forgotten while the app has been running. A change already on
 * its way when the account was deleted — a saved search's alert checked as
 * the app opened, a note's Undo, a reminder put back — would otherwise write
 * their list again after it was removed; for them nothing is read or written
 * any more. An id is never anybody else's, so this costs nobody anything.
 */
const forgotten = new Set<string>();

/**
 * A short list kept on this phone, one per person (`owner`: their user id,
 * or 'anon' signed out), newest first: read once, written on every change,
 * and followed by every screen that shows it. What one person keeps on a
 * shared phone is not what the next one sees.
 *
 * Used for the jobs looked at lately, a company's saved WhatsApp replies and
 * its saved consultant searches — nothing the website needs to know.
 */
export function createLocalList<T>(prefix: string, { max, idOf, valid }: { max: number; idOf: (item: T) => string; valid: (item: unknown) => item is T }) {
  const kept = new Map<string, Kept<T>>();

  const storeFor = (owner: string): Kept<T> => {
    let store = kept.get(owner);
    if (!store) {
      store = { items: [], loaded: false, loading: null, listeners: new Set() };
      kept.set(owner, store);
    }
    return store;
  };

  const emit = (store: Kept<T>) => {
    for (const listener of store.listeners) listener();
  };

  const load = (owner: string): Promise<void> => {
    const store = storeFor(owner);
    store.loading ??= (forgotten.has(owner) ? Promise.resolve(null) : AsyncStorage.getItem(`${prefix}:${owner}`))
      .then((stored) => {
        // Read before the account was deleted, answered after: nothing of it comes back.
        if (forgotten.has(owner)) return;
        const parsed = stored ? (JSON.parse(stored) as unknown) : [];
        const read = Array.isArray(parsed) ? parsed.filter(valid) : [];
        // Anything kept while the phone was still answering stays, first.
        const ids = new Set(store.items.map(idOf));
        store.items = [...store.items, ...read.filter((item) => !ids.has(idOf(item)))].slice(0, max);
      })
      .catch(() => {})
      .finally(() => {
        store.loaded = true;
        emit(store);
      });
    return store.loading;
  };

  const save = (owner: string, next: readonly T[]) => {
    if (forgotten.has(owner)) return;
    const store = storeFor(owner);
    store.items = next.slice(0, max);
    emit(store);
    AsyncStorage.setItem(`${prefix}:${owner}`, JSON.stringify(store.items)).catch(() => {});
  };

  /** Changes once the phone has said what it holds, so nothing kept before is written over. */
  const change = (owner: string, update: (items: readonly T[]) => readonly T[]) => {
    const store = storeFor(owner);
    if (store.loaded) save(owner, update(store.items));
    else void load(owner).then(() => save(owner, update(storeFor(owner).items)));
  };

  lists.add({
    forget(owner) {
      const store = kept.get(owner);
      if (!store) return;
      kept.delete(owner);
      // Whoever still follows it sees it empty, and reads afresh (an empty phone) next time.
      store.items = [];
      emit(store);
    },
  });

  return {
    /** Put first, replacing one with the same id. */
    add(owner: string, item: T) {
      change(owner, (items) => [item, ...items.filter((existing) => idOf(existing) !== idOf(item))]);
    },
    /** Changes one where it stands, from what it holds now; nothing when it is no longer kept. */
    update(owner: string, id: string, next: (current: T) => T) {
      change(owner, (items) => items.map((item) => (idOf(item) === id ? next(item) : item)));
    },
    remove(owner: string, id: string) {
      change(owner, (items) => items.filter((item) => idOf(item) !== id));
    },
    clear(owner: string) {
      change(owner, () => []);
    },
    /** All of it at once, in this order: a list kept as the server last gave it. */
    replace(owner: string, items: readonly T[]) {
      change(owner, () => items);
    },
    useItems(owner: string): readonly T[] {
      useEffect(() => {
        void load(owner);
      }, [owner]);
      return useSyncExternalStore(
        (listener) => {
          const store = storeFor(owner);
          store.listeners.add(listener);
          return () => {
            store.listeners.delete(listener);
          };
        },
        () => storeFor(owner).items,
      );
    },
    /** Read straight from the phone, for work outside a screen (a check when the app opens). */
    async read(owner: string): Promise<readonly T[]> {
      await load(owner);
      return storeFor(owner).items;
    },
    resetForTests() {
      kept.clear();
      // A fresh app, as each test expects: nobody forgotten yet.
      forgotten.clear();
    },
  };
}

/** The system's names for notifications a kept list holds (a reminder's `notificationId`). */
function scheduledIn(stored: string | null): string[] {
  try {
    const parsed = stored ? (JSON.parse(stored) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (item as { notificationId?: unknown } | null)?.notificationId)
      .filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

/**
 * Everything this phone keeps for one person, gone: every key kept under
 * their id (`…:${userId}` — the lists above, and push's own choices), and
 * the notifications those lists had scheduled (a saved listing's reminder),
 * so a deleted account leaves nothing of itself on a shared phone. Never
 * throws; what cannot be removed now is left as it was.
 */
export async function forgetPerson(userId: string): Promise<void> {
  if (!userId) return;
  forgotten.add(userId);
  const suffix = `:${userId}`;
  const keys = (await AsyncStorage.getAllKeys().catch(() => [] as readonly string[])).filter((key) => key.endsWith(suffix));
  for (const list of lists) list.forget(userId);
  const stored = await AsyncStorage.multiGet(keys).catch(() => [] as readonly (readonly [string, string | null])[]);
  for (const [, value] of stored) {
    for (const id of scheduledIn(value)) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    }
  }
  await AsyncStorage.multiRemove(keys).catch(() => {});
}
