import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A list of ids the reader hid, kept on this phone under `key`: read once,
 * written on every change, and followed by every screen that shows it
 * (hidden-companies.ts, hidden-agents.ts).
 */
export function createHiddenStore(key: string) {
  let hidden: ReadonlySet<string> = new Set();
  let loading: Promise<void> | null = null;
  let loaded = false;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const load = (): Promise<void> => {
    loading ??= AsyncStorage.getItem(key)
      .then((stored) => {
        const ids = stored ? (JSON.parse(stored) as unknown) : [];
        if (Array.isArray(ids)) hidden = new Set([...hidden, ...ids.filter((id): id is string => typeof id === 'string')]);
      })
      .catch(() => {})
      .finally(() => {
        loaded = true;
        emit();
      });
    return loading;
  };

  const save = (next: ReadonlySet<string>) => {
    hidden = next;
    emit();
    AsyncStorage.setItem(key, JSON.stringify([...next])).catch(() => {});
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    hide(id: string) {
      if (!hidden.has(id)) save(new Set([...hidden, id]));
    },
    unhide(id: string) {
      if (hidden.has(id)) save(new Set([...hidden].filter((existing) => existing !== id)));
    },
    /** The hidden ids, kept current wherever they change. */
    useHidden(): ReadonlySet<string> {
      useEffect(() => {
        void load();
      }, []);
      return useSyncExternalStore(subscribe, () => hidden);
    },
    /** Whether the phone has said which ids are hidden. */
    useLoaded(): boolean {
      useEffect(() => {
        void load();
      }, []);
      return useSyncExternalStore(subscribe, () => loaded);
    },
  };
}
