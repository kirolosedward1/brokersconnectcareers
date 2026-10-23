'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeDraft, pruneDrafts, readDraft, removeDraft, stillShown, writeDraft } from '@/lib/form-draft';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** How long after the last keystroke a draft is written. */
const SETTLE_MS = 400;

export type DraftState = {
  /** A draft was put back into the form when it opened; when it was typed. */
  restoredAt: number | null;
  /**
   * A draft typed over an older version of this record, held back rather than
   * put in: when it was typed. `accept` puts it in, `discard` throws it away.
   */
  offeredAt: number | null;
  accept: () => void;
  /** Throws the draft away and puts the form back the way it opened. */
  discard: () => void;
  /** Writes now rather than after the pause: before a send that may not come back. */
  flush: () => void;
  /**
   * The form was sent and accepted. The draft goes, and what is on screen now
   * is what the server holds, so it becomes the state a new draft is measured
   * against — for a form that stays open after saving.
   */
  clear: () => void;
};

/**
 * Keeps a form's values as a draft (lib/form-draft.ts) while it is open, and
 * puts them back when it is opened again.
 *
 * `values` is everything the form would lose — one object, so a wizard's step
 * goes with its fields — and `restore` sets the form to such an object. Its
 * values must be plain data that survives JSON.
 *
 * `key` is null while there is nobody to keep it for, which turns this off.
 *
 * Read after mount, never during render: the server has no storage, and a
 * first render that differed from the server's would be a hydration error.
 * So the form paints as the server built it, then fills in.
 *
 * Nothing is written for a form nobody has touched: a draft is only what
 * differs from the state the form opened with.
 *
 * `typed` picks out what is typed from what is only where the form is (a
 * wizard's step): moving between steps to look at the current version is not
 * an answer to an offered draft, and must not throw it away.
 */
export function useFormDraft<T>({
  key,
  values,
  restore,
  typed = (all) => all,
  base = null,
}: {
  key: string | null;
  values: T;
  restore: (values: T) => void;
  typed?: (values: T) => unknown;
  /** The server version the form was built from; see Draft.base. */
  base?: string | number | null;
}): DraftState {
  const baseText = base == null ? null : String(base);

  const pristine = useRef(values);
  const latest = useRef(values);
  latest.current = values;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const typedRef = useRef(typed);
  typedRef.current = typed;

  /** What is stored now, as JSON, so an unchanged form is not written again. */
  const written = useRef<string | null>(null);
  /** The render that carried the opening values past a restore is not a change. */
  const skipNext = useRef(false);
  const ready = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [offer, setOffer] = useState<{ values: T; savedAt: number; from?: T } | null>(null);
  const offerRef = useRef(offer);
  offerRef.current = offer;

  const save = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!key || !ready.current || offerRef.current) return;
    const current = latest.current;
    if (same(current, pristine.current)) {
      // Typed and then undone: nothing differs, so nothing is kept.
      if (written.current !== null) removeDraft(key);
      written.current = null;
      return;
    }
    const json = JSON.stringify(current);
    if (json === written.current) return;
    if (writeDraft(key, current, baseText, Date.now(), pristine.current)) written.current = json;
  }, [key, baseText]);

  // Opening: read what was kept, if anything, and put it in or hold it back.
  useEffect(() => {
    ready.current = false;
    written.current = null;
    if (!key) return;

    pruneDrafts();
    const draft = readDraft<T>(key);
    if (draft && !same(draft.values, pristine.current) && stillShown(draft.values, pristine.current, latest.current)) {
      // What is on screen already (the form's version moved under it, after
      // its own save): nothing to give back; written again under this version.
      ready.current = true;
      save();
      return;
    }
    if (draft && !same(draft.values, pristine.current)) {
      written.current = JSON.stringify(draft.values);
      if (baseText !== null && draft.base !== baseText) {
        // The ref as well as the state, now: a write before the next render
        // (React replaying effects, a tab closed at once) must already see
        // the offer, or it measures the form against the opening values,
        // finds nothing typed, and deletes the draft it was holding back.
        offerRef.current = { values: draft.values, savedAt: draft.savedAt, from: draft.from };
        setOffer(offerRef.current);
      } else {
        skipNext.current = true;
        restoreRef.current(draft.values);
        setRestoredAt(draft.savedAt);
      }
    } else if (draft) {
      // The same as the form already holds: nothing to give back.
      removeDraft(key);
    }
    ready.current = true;
  }, [key, baseText, save]);

  // Changing: write once the typing settles.
  useEffect(() => {
    if (!key || !ready.current) return;
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    if (offerRef.current) {
      // Typing without answering the offer is the answer: what is typed now
      // is the work, and it takes the old draft's place.
      if (same(typedRef.current(values), typedRef.current(pristine.current))) return;
      setOffer(null);
      offerRef.current = null;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, SETTLE_MS);
  }, [key, values, save]);

  // Leaving: a closed tab, a phone backgrounding the browser, or the sign-in
  // a lapsed session sends the person to. The pause is not waited out.
  useEffect(() => {
    if (!key) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') save();
    };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onHide);
      if (timer.current) save();
    };
  }, [key, save]);

  const accept = useCallback(() => {
    const held = offerRef.current;
    if (!held) return;
    setOffer(null);
    offerRef.current = null;
    // Written again under the version on screen: it has been looked at now.
    written.current = null;
    // Only what the person changed comes back; a field they never touched
    // keeps what was saved since (mergeDraft).
    restoreRef.current(mergeDraft(held.values, held.from, latest.current));
    setRestoredAt(held.savedAt);
  }, []);

  const discard = useCallback(() => {
    if (key) removeDraft(key);
    written.current = null;
    setOffer(null);
    offerRef.current = null;
    setRestoredAt(null);
    if (!same(latest.current, pristine.current)) restoreRef.current(pristine.current);
  }, [key]);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (key) removeDraft(key);
    written.current = null;
    pristine.current = latest.current;
    setOffer(null);
    offerRef.current = null;
    setRestoredAt(null);
  }, [key]);

  return { restoredAt, offeredAt: offer?.savedAt ?? null, accept, discard, flush: save, clear };
}
