import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Companies the reader has hidden on this phone.
 *
 * The App Store asks an app where people publish to let a reader block whoever
 * is abusing it; on a job board that is a company whose listings they never
 * want to see again. Hidden here, the company's listings leave the board, the
 * home screen and "roles like this", and it leaves the directory — on this
 * phone, signed in or not, until the reader takes it back from the company's
 * own page. Reporting it (reportTarget) is what reaches the team; hiding is
 * the reader's own relief in the meantime.
 *
 * Kept on the device: a list of company ids, nobody else's business, and
 * nothing the server needs in order to answer anyone else.
 */
const KEY = 'bc.hidden-companies.v1';

let hidden: ReadonlySet<string> = new Set();
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function load(): Promise<void> {
  loading ??= AsyncStorage.getItem(KEY)
    .then((stored) => {
      const ids = stored ? (JSON.parse(stored) as unknown) : [];
      if (Array.isArray(ids)) {
        hidden = new Set([...hidden, ...ids.filter((id): id is string => typeof id === 'string')]);
        emit();
      }
    })
    .catch(() => {});
  return loading;
}

function save(next: ReadonlySet<string>) {
  hidden = next;
  emit();
  AsyncStorage.setItem(KEY, JSON.stringify([...next])).catch(() => {});
}

export function hideCompany(id: string) {
  if (!hidden.has(id)) save(new Set([...hidden, id]));
}

export function unhideCompany(id: string) {
  if (hidden.has(id)) save(new Set([...hidden].filter((existing) => existing !== id)));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The hidden company ids, kept current wherever they change. */
export function useHiddenCompanies(): ReadonlySet<string> {
  useEffect(() => {
    void load();
  }, []);
  return useSyncExternalStore(subscribe, () => hidden);
}

/** A list without the listings of hidden companies. */
export function withoutHidden<T extends { company: { id: string } }>(items: T[], ids: ReadonlySet<string>): T[] {
  return ids.size ? items.filter((item) => !ids.has(item.company.id)) : items;
}
