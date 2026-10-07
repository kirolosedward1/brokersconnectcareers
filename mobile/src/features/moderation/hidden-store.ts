import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** One thing the reader hid, with what it was called then — for the list they bring it back from. */
export type HiddenEntry = { id: string; name: string | null; slug: string | null };

/**
 * A list of what the reader hid, kept on this phone under `key`: read once,
 * written on every change, and followed by every screen that shows it
 * (hidden-companies.ts, hidden-agents.ts). Each entry keeps the name it was
 * hidden under, so Account → "Hidden on this phone" can list them without
 * asking anyone; a list written before names were kept (a bare id) still reads.
 */
export function createHiddenStore(key: string) {
  let entries: readonly HiddenEntry[] = [];
  let ids: ReadonlySet<string> = new Set();
  let loading: Promise<void> | null = null;
  let loaded = false;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const set = (next: readonly HiddenEntry[]) => {
    entries = next;
    ids = new Set(next.map((entry) => entry.id));
  };

  const load = (): Promise<void> => {
    loading ??= AsyncStorage.getItem(key)
      .then((stored) => {
        const parsed = stored ? (JSON.parse(stored) as unknown) : [];
        if (!Array.isArray(parsed)) return;
        const read = parsed.flatMap((item): HiddenEntry[] => {
          if (typeof item === 'string') return [{ id: item, name: null, slug: null }];
          if (item && typeof item === 'object' && typeof (item as HiddenEntry).id === 'string') {
            const { id, name, slug } = item as HiddenEntry;
            return [{ id, name: typeof name === 'string' ? name : null, slug: typeof slug === 'string' ? slug : null }];
          }
          return [];
        });
        // Anything hidden while the phone was still answering stays hidden.
        set([...read.filter((entry) => !ids.has(entry.id)), ...entries]);
      })
      .catch(() => {})
      .finally(() => {
        loaded = true;
        emit();
      });
    return loading;
  };

  const save = (next: readonly HiddenEntry[]) => {
    set(next);
    emit();
    AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {});
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    hide(id: string, about: { name?: string | null; slug?: string | null } = {}) {
      if (!ids.has(id)) save([...entries, { id, name: about.name ?? null, slug: about.slug ?? null }]);
    },
    unhide(id: string) {
      if (ids.has(id)) save(entries.filter((entry) => entry.id !== id));
    },
    /** The hidden ids, kept current wherever they change. */
    useHidden(): ReadonlySet<string> {
      useEffect(() => {
        void load();
      }, []);
      return useSyncExternalStore(subscribe, () => ids);
    },
    /** What is hidden, in the order it was hidden, with the names it had then. */
    useEntries(): readonly HiddenEntry[] {
      useEffect(() => {
        void load();
      }, []);
      return useSyncExternalStore(subscribe, () => entries);
    },
    /** Whether the phone has said what is hidden. */
    useLoaded(): boolean {
      useEffect(() => {
        void load();
      }, []);
      return useSyncExternalStore(subscribe, () => loaded);
    },
  };
}

/**
 * A list's total without what this phone hides: the server counts everything,
 * and the rows already here say how many of them were left out. Exact once
 * the list has been read to its end; never below what is shown.
 */
export function totalShown(total: number, read: number, shown: number): number {
  return Math.max(shown, total - (read - shown));
}
