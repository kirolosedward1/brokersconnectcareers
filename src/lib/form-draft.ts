/**
 * What a person typed into a long form, kept in their browser until it is sent.
 *
 * Every form here held its work in React state and nowhere else. A job advert
 * is four steps and up to sixteen thousand characters of description; closing
 * the tab, a phone killing the browser in the background, or a session that
 * expired mid-form took all of it — the last one by design, because
 * recoverExpiredSession sends the person to sign in and back, and the page
 * they come back to is built fresh, empty. The "sign in again" was honest; the
 * blank form after it was not.
 *
 * So a form writes what it holds here as it changes, and reads it back when it
 * is opened again. What is kept, and for how long, is narrow on purpose,
 * because this is someone's phone number and words in a browser that may be a
 * shared one:
 *
 *   - Under the account it was typed for (`draftKey`): a draft is never read
 *     back for another account signed in on the same browser.
 *   - Seven days at most, after which it is deleted the next time any form
 *     looks. A week covers "I'll finish it tomorrow"; it does not keep a
 *     stranger's half-written advert on an internet-café PC for a season.
 *   - All of them are deleted on signing out (`forgetDrafts`).
 *   - Never a file: a CV or a scan stays only in the picker that holds it.
 *     Never a consent tick: agreeing is done each time, not remembered.
 *   - Removed the moment the form is sent and accepted.
 *
 * Listed on the cookie page (content/legal/cookies.*.md), and
 * scripts/legal.test.mjs holds this file to the name it is listed under.
 *
 * Every access is inside a try: storage throws in private modes, when it is
 * full, and when the browser blocks site data, and a form must work exactly as
 * it did before this existed in all of them.
 *
 * No imports and no React, so scripts/form-draft.test.mjs can load it under
 * Node with a stand-in localStorage.
 */

const PREFIX = 'bc-draft:';
const SHAPE = 1;

/** How long a draft is kept: a week. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The most one draft may take, in characters of JSON. The largest form (a job
 * advert at every field's maxLength) is about twenty-five thousand; this is
 * room for that, and a ceiling on what a bug could pile into storage.
 */
const MAX_CHARS = 64_000;

export type Draft<T> = {
  values: T;
  /** When it was last written, in ms since the epoch. */
  savedAt: number;
  /**
   * The server version the form was built from when it was typed (a listing's
   * `version`), or null for a form with no version. A draft whose base is not
   * the version on screen now was typed over something that has since changed.
   */
  base: string | null;
};

type Stored = { v: number; at: number; base: string | null; values: unknown };

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The key a form keeps its draft under: which form, whose, and which record.
 * `subject` is the record being edited (a listing's id), or "new".
 */
export function draftKey(form: string, owner: string, subject: string | null = null): string {
  return `${PREFIX}${form}:${owner}:${subject ?? 'new'}`;
}

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

/**
 * The draft under `key`, or null. One that is past its week, unreadable, or
 * from a shape this code no longer writes is deleted on the way.
 */
export function readDraft<T>(key: string, now: number = Date.now()): Draft<T> | null {
  const store = storage();
  if (!store) return null;
  try {
    const stored = parse(store.getItem(key));
    if (!stored || now - stored.at > DRAFT_MAX_AGE_MS || stored.at > now + 60_000) {
      store.removeItem(key);
      return null;
    }
    return { values: stored.values as T, savedAt: stored.at, base: stored.base };
  } catch {
    return null;
  }
}

/**
 * Keeps `values` under `key`. False when it could not: no storage, storage
 * full, or a draft past the size ceiling — which also removes what was kept
 * before, so a reader is never handed an older version as if it were the last.
 */
export function writeDraft<T>(
  key: string,
  values: T,
  base: string | null = null,
  now: number = Date.now(),
): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const json = JSON.stringify({ v: SHAPE, at: now, base, values } satisfies Stored);
    if (json.length > MAX_CHARS) {
      store.removeItem(key);
      return false;
    }
    // `store` is localStorage; named so here for scripts/legal.test.mjs, which
    // finds what the website writes to a browser by this spelling.
    localStorage.setItem(key, json);
    return true;
  } catch {
    try {
      store.removeItem(key);
    } catch {
      // Nothing more to do: the form goes on without a draft.
    }
    return false;
  }
}

export function removeDraft(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // As above.
  }
}

/** Every key this module wrote that `keep` does not want kept. */
function sweep(keep: (key: string, raw: string | null) => boolean): number {
  const store = storage();
  if (!store) return 0;
  try {
    const doomed: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key?.startsWith(PREFIX) && !keep(key, store.getItem(key))) doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
    return doomed.length;
  } catch {
    return 0;
  }
}

/**
 * Deletes every draft in this browser: on signing out, so the next person at
 * a shared computer finds nothing of the last one's.
 */
export function forgetDrafts(): number {
  return sweep(() => false);
}

/** Deletes the drafts past their week, or unreadable, for every form and account. */
export function pruneDrafts(now: number = Date.now()): number {
  return sweep((_key, raw) => {
    const stored = parse(raw);
    return Boolean(stored) && now - stored!.at <= DRAFT_MAX_AGE_MS;
  });
}
