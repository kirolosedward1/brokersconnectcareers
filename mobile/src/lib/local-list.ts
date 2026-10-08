import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Kept<T> = {
  items: readonly T[];
  loaded: boolean;
  loading: Promise<void> | null;
  listeners: Set<() => void>;
};

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
    store.loading ??= AsyncStorage.getItem(`${prefix}:${owner}`)
      .then((stored) => {
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

  return {
    /** Put first, replacing one with the same id. */
    add(owner: string, item: T) {
      change(owner, (items) => [item, ...items.filter((existing) => idOf(existing) !== idOf(item))]);
    },
    remove(owner: string, id: string) {
      change(owner, (items) => items.filter((item) => idOf(item) !== id));
    },
    clear(owner: string) {
      change(owner, () => []);
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
    },
  };
}
