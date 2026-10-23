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
 * is sent, on "start over", on discarding at the leave guard, on signing out
 * and on deleting the account (signOutHere). A session that only ran out — a
 * refresh refused, a password changed on the website — keeps them, as the
 * website does, so the person signs in again and carries on; somebody else
 * signing in takes everybody else's away (push-bridge.tsx). Never a file and
 * never a CV choice — a picked file lives in the cache, which signing out
 * empties too.
 *
 * Listed on the cookie page under "What the app keeps on your phone".
 *
 * Every call swallows its failure: a phone whose storage refuses is a form
 * without a draft, never a form that stops working.
 */
export { draftKey };

const PREFIX = 'bc-draft:';

/**
 * Set by a sign-out (forgetKeptDrafts with nobody kept), until the next
 * sign-in: a form closing after the sign-out, its last keystrokes still on the
 * way, would otherwise write a draft back for somebody no longer here.
 */
let sealed = false;
const SHAPE = 1;
/** The ceiling for one draft, as on the website: room for the longest form, and no more. */
const MAX_CHARS = 64_000;

/** `from`: what the form held when this was typed over it, for mergeDraft (form-draft.ts). */
export type KeptDraft<T> = { values: T; savedAt: number; base: string | null; from?: T };

type Stored = { v: number; at: number; base: string | null; values: unknown; from?: unknown };

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
  return {
    values: stored.values as T,
    savedAt: stored.at,
    base: stored.base,
    ...(stored.from === undefined ? {} : { from: stored.from as T }),
  };
}

/** Keeps `values` under `key`; false when it could not, which also drops what was kept before. */
export async function keepDraft<T>(
  key: string,
  values: T,
  base: string | null = null,
  now: number = Date.now(),
  from?: T,
): Promise<boolean> {
  if (sealed) return false;
  let json = JSON.stringify({ v: SHAPE, at: now, base, values, from } satisfies Stored);
  // Past the ceiling, kept without the opening values rather than not at all.
  if (json.length > MAX_CHARS) json = JSON.stringify({ v: SHAPE, at: now, base, values } satisfies Stored);
  if (json.length > MAX_CHARS) {
    await AsyncStorage.removeItem(key).catch(() => {});
    return false;
  }
  try {
    await AsyncStorage.setItem(key, json);
    // Signed out while this was on its way: it goes too.
    if (sealed) {
      await AsyncStorage.removeItem(key).catch(() => {});
      return false;
    }
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

/** Whose a draft key is: `bc-draft:<form>:<owner>:<record>` (draftKey). */
const ownerOf = (key: string) => key.split(':')[2] ?? '';

/**
 * Every draft on this phone, gone — on signing out or deleting the account, so
 * the next person finds none of the last one's. With `except`, the drafts of
 * that account stay: somebody signing in keeps their own and the phone lets go
 * of everybody else's.
 */
export async function forgetKeptDrafts(except?: string): Promise<void> {
  // A sign-out keeps nothing until somebody signs in; a sign-in (`except`) writes again.
  sealed = !except;
  const keys = (await draftKeys()).filter((key) => !except || ownerOf(key) !== except);
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
