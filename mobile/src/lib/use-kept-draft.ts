import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { dropDraft, keepDraft, pruneKeptDrafts, readKeptDraft } from '~/lib/kept-draft';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** How long after the last change a draft is written. */
const SETTLE_MS = 400;

export type KeptDraftState = {
  /** A draft was put back into the form when it opened; when it was typed. */
  restoredAt: number | null;
  /** One held back — typed over an older version, or found after typing had begun; when it was typed. */
  offeredAt: number | null;
  accept: () => void;
  /** Throws the draft away and puts the form back the way it opened. */
  discard: () => void;
  /** The form is being left on purpose (the leave guard's "discard"): the draft goes, the fields stay. */
  drop: () => void;
  /** Sent and accepted: the draft goes. */
  clear: () => void;
};

/**
 * Keeps a form's values as a draft (kept-draft.ts) while it is open, and puts
 * them back when it opens again — the website's useFormDraft, for the phone.
 *
 * `values` is everything the form would lose, as plain data; `restore` sets the
 * form to such a value. `key` null turns it off (nobody signed in). `base` is
 * the server version the form was built from: a draft typed over another one
 * is offered rather than poured in, so a colleague's save is never undone
 * unasked.
 *
 * The read takes a moment, and somebody may have started typing by then:
 * their typing is not overwritten — the draft is offered instead.
 *
 * Written once the typing settles, and at once when the app leaves the
 * foreground — the moment iOS may end it without asking.
 */
export function useKeptDraft<T>({
  key,
  values,
  restore,
  base = null,
}: {
  key: string | null;
  values: T;
  restore: (values: T) => void;
  base?: string | number | null;
}): KeptDraftState {
  const baseText = base == null ? null : String(base);
  const pristine = useRef(values);
  const latest = useRef(values);
  const restoreRef = useRef(restore);

  const ready = useRef(false);
  const written = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Writes in the order they were asked for: an older one finishing last must not win.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [offer, setOffer] = useState<{ values: T; savedAt: number } | null>(null);
  const offerRef = useRef(offer);
  // What the handlers and timers read: this drawing's values. Synced before the
  // effects below run — effects run in the order they are declared.
  useEffect(() => {
    latest.current = values;
    restoreRef.current = restore;
    offerRef.current = offer;
  });

  const enqueue = useCallback((work: () => Promise<unknown>) => {
    queue.current = queue.current.then(work, work);
  }, []);

  const save = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!key || !ready.current || offerRef.current) return;
    const current = latest.current;
    if (same(current, pristine.current)) {
      if (written.current !== null) enqueue(() => dropDraft(key));
      written.current = null;
      return;
    }
    const json = JSON.stringify(current);
    if (json === written.current) return;
    written.current = json;
    enqueue(async () => {
      if (!(await keepDraft(key, current, baseText))) written.current = null;
    });
  }, [key, baseText, enqueue]);

  // Opening: read what was kept, then put it in or hold it back.
  useEffect(() => {
    ready.current = false;
    written.current = null;
    if (!key) return;
    let live = true;
    (async () => {
      await pruneKeptDrafts();
      const draft = await readKeptDraft<T>(key);
      if (!live) return;
      if (draft && !same(draft.values, pristine.current)) {
        written.current = JSON.stringify(draft.values);
        const stale = baseText !== null && draft.base !== baseText;
        const typing = !same(latest.current, pristine.current);
        if (stale || typing) {
          offerRef.current = { values: draft.values, savedAt: draft.savedAt };
          setOffer(offerRef.current);
        } else {
          restoreRef.current(draft.values);
          setRestoredAt(draft.savedAt);
        }
      } else if (draft) {
        void dropDraft(key);
      }
      ready.current = true;
      // What was typed while the read was out has not been written yet.
      if (!offerRef.current) save();
    })().catch(() => {
      ready.current = true;
    });
    return () => {
      live = false;
    };
  }, [key, baseText, save]);

  // Changing: write once the typing settles. Typing past an offer answers it.
  useEffect(() => {
    if (!key || !ready.current) return;
    if (offerRef.current) {
      if (same(values, pristine.current)) return;
      offerRef.current = null;
      setOffer(null);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, SETTLE_MS);
  }, [key, values, save]);

  // Leaving the foreground, and leaving the screen: not waited out.
  useEffect(() => {
    if (!key) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') save();
    });
    return () => {
      subscription.remove();
      if (timer.current) save();
    };
  }, [key, save]);

  const accept = useCallback(() => {
    const held = offerRef.current;
    if (!held) return;
    offerRef.current = null;
    setOffer(null);
    written.current = null;
    restoreRef.current(held.values);
    setRestoredAt(held.savedAt);
  }, []);

  const forget = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (key) enqueue(() => dropDraft(key));
    written.current = null;
    offerRef.current = null;
    setOffer(null);
    setRestoredAt(null);
  }, [key, enqueue]);

  const discard = useCallback(() => {
    forget();
    if (!same(latest.current, pristine.current)) restoreRef.current(pristine.current);
  }, [forget]);

  const drop = useCallback(() => {
    forget();
    // Nothing more is written for these fields: they are being left.
    pristine.current = latest.current;
  }, [forget]);

  return { restoredAt, offeredAt: offer?.savedAt ?? null, accept, discard, drop, clear: drop };
}
