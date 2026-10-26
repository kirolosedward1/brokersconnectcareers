import AsyncStorage from '@react-native-async-storage/async-storage';
import { DRAFT_MAX_AGE_MS, draftKey } from '@/lib/form-draft';

/**
 * What a person typed into a long form, kept on the phone until it is sent —
 * the website's lib/form-draft.ts, on AsyncStorage.
 *
 * The leave guard (use-leave-guard.ts) asks before Back throws typed work
 * away, but iOS ending the app in the background asks nobody: an employer
 * who switched to WhatsApp to copy a commission figure came back to an empty
 * wizard, eight thousand characters gone. So the form keeps what it holds here
 * as it changes and reads it back when it opens again.
 *
 * The same rules as the website, and the same key shape (`draftKey`): under the
 * account and the record it was typed for, a week at most, gone once the form
 * is sent, on "start over", on discarding at the leave guard, and on signing
 * out (push-bridge.tsx). Never a file and never a CV choice — a picked file
 * lives in the cache, which signing out empties too.
 *
 * Listed on the cookie page under "What the app keeps on your phone".
 *
 * Every call swallows its failure: a phone whose storage refuses is a form
 * without a draft, never a form that stops working.
 */
export { draftKey };

const PREFIX = 'bc-draft:';
const SHAPE = 1;
/** The ceiling for one draft, as on the website: room for the longest form, and no more. */
const MAX_CHARS = 64_000;

export type KeptDraft<T> = { values: T; savedAt: number; base: string | null };

type Stored = { v: number; at: number; base: string | null; values: unknown };

function parse(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as Stored;
    if (!stored || typeof stored !== 'object') return null;
    if (stored.v !== SHAPE || typeof stored.at !== 'number' || !('values' in stored)) return null;
    if (stored.base !== null && typeof stored.base !== 'string') return null;
    return stored;
  } catch {
    return null;
  }
}

const fresh = (stored: Stored, now: number) => now - stored.at <= DRAFT_MAX_AGE_MS && stored.at <= now + 60_000;

/** The draft under `key`, or null; one past its week or unreadable is removed on the way. */
export async function readKeptDraft<T>(key: string, now: number = Date.now()): Promise<KeptDraft<T> | null> {
  const raw = await AsyncStorage.getItem(key).catch(() => null);
  if (raw === null) return null;
  const stored = parse(raw);
  if (!stored || !fresh(stored, now)) {
    await AsyncStorage.removeItem(key).catch(() => {});
    return null;
  }
  return { values: stored.values as T, savedAt: stored.at, base: stored.base };
}

/** Keeps `values` under `key`; false when it could not, which also drops what was kept before. */
export async function keepDraft<T>(key: string, values: T, base: string | null = null, now: number = Date.now()): Promise<boolean> {
  const json = JSON.stringify({ v: SHAPE, at: now, base, values } satisfies Stored);
  if (json.length > MAX_CHARS) {
    await AsyncStorage.removeItem(key).catch(() => {});
    return false;
  }
  try {
    await AsyncStorage.setItem(key, json);
    return true;
  } catch {
    await AsyncStorage.removeItem(key).catch(() => {});
    return false;
  }
}

export function dropDraft(key: string): Promise<void> {
  return AsyncStorage.removeItem(key).catch(() => {});
}

async function draftKeys(): Promise<string[]> {
  const keys = await AsyncStorage.getAllKeys().catch(() => [] as readonly string[]);
  return keys.filter((key) => key.startsWith(PREFIX));
}

/** Every draft on this phone, gone: on signing out, so the next person finds none of the last one's. */
export async function forgetKeptDrafts(): Promise<void> {
  const keys = await draftKeys();
  if (keys.length) await AsyncStorage.multiRemove(keys).catch(() => {});
}

/** The drafts past their week or unreadable, for every form and account. */
export async function pruneKeptDrafts(now: number = Date.now()): Promise<void> {
  const keys = await draftKeys();
  if (!keys.length) return;
  const pairs = await AsyncStorage.multiGet(keys).catch(() => [] as readonly (readonly [string, string | null])[]);
  const stale = pairs.filter(([, raw]) => {
    const stored = parse(raw);
    return !stored || !fresh(stored, now);
  });
  if (stale.length) await AsyncStorage.multiRemove(stale.map(([key]) => key)).catch(() => {});
}
