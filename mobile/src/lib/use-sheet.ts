import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { CLOSING_MS, sheetClosing, sheetShowing, whenSheetsSettled } from './sheet-gate';

/**
 * A sheet (a React Native Modal) that is drawn only while it is wanted —
 * one per card of a list would be a modal per card — and kept until it has
 * finished closing. iOS cannot present a sheet while one is still being
 * dismissed — this one or any other: drawn again at once, a sheet opened in
 * that moment never showed, and its button did nothing until the screen was
 * left. So `show` waits out every sheet still closing (sheet-gate.ts) and
 * then opens — a tap then takes a moment rather than doing nothing — and
 * this one's own closing is counted until iOS says it has gone (`onDismiss`)
 * or, whatever iOS says, a moment after, when it is unmounted.
 */
export function useSheet() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What to do once it has gone: an alert or another sheet, which iOS would not present over one still closing.
  const then = useRef<(() => void) | null>(null);
  // An open asked for while another sheet was still closing, and this one's own closing still counted.
  const opening = useRef<(() => void) | null>(null);
  const closed = useRef<(() => void) | null>(null);
  // Showing, for leaveSheets (sheet-gate.ts), which closes it as hide() does.
  const unlisted = useRef<(() => void) | null>(null);
  const hideNow = useRef<() => void>(() => {});
  // A show() asked for while this sheet is still closing. The close must not
  // take that next one down: both land in one turn, and the close was winning,
  // so the sheet never appeared. Cleared once that close has had its say, so
  // an unasked dismiss afterwards still counts.
  const reopen = useRef(false);
  // The close timer has not fired yet. The open it was waiting on must leave
  // `reopen` set until that timer has decided to keep the sheet.
  const closePending = useRef(false);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      opening.current?.();
      unlisted.current?.();
      unlisted.current = null;
      // Chosen, and then taken away with its row (a list drawn again) before it
      // had gone: still done, once iOS has had the time to take the sheet down.
      const next = then.current;
      then.current = null;
      if (next) setTimeout(next, CLOSING_MS);
    },
    [],
  );

  const gone = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    closePending.current = false;
    // A show() since this close started is the next sheet. Taking this one
    // down in the same turn set it closed again, and it never appeared.
    const followed = reopen.current;
    // Gone while still meant to be open: iOS took it down unawares. Left
    // "open", the next show() did nothing and its button was dead.
    if (!followed && open) {
      setOpen(false);
      unlisted.current?.();
      unlisted.current = null;
    }
    if (!followed) setMounted(false);
    closed.current?.();
    closed.current = null;
    const next = then.current;
    then.current = null;
    next?.();
    if (followed) reopen.current = false;
  };

  /** Closes it; `after` runs once it has gone. (Handed to onPress, it is given an event: only a function is kept.) */
  const hide = (after?: unknown) => {
    const next = typeof after === 'function' ? (after as () => void) : null;
    opening.current?.();
    opening.current = null;
    if (!open) {
      next?.();
      return;
    }
    reopen.current = false;
    setOpen(false);
    // No longer showing — once its closing is counted, so nothing waiting on
    // the sheets (leaveSheets) goes before it has gone.
    const unlist = () => {
      unlisted.current?.();
      unlisted.current = null;
    };
    if (Platform.OS !== 'ios') {
      setMounted(false);
      unlist();
      next?.();
      return;
    }
    if (next) then.current = next;
    closed.current?.();
    closed.current = sheetClosing();
    unlist();
    if (timer.current) clearTimeout(timer.current);
    closePending.current = true;
    timer.current = setTimeout(gone, CLOSING_MS);
  };
  useEffect(() => {
    hideNow.current = () => hide();
  });

  return {
    open,
    /** Whether to draw the sheet at all: while open, and while it closes. */
    mounted: open || mounted,
    show() {
      if (open) return;
      reopen.current = true;
      opening.current?.();
      opening.current = whenSheetsSettled(() => {
        opening.current = null;
        if (!reopen.current) return;
        setMounted(true);
        setOpen(true);
        // Nothing of this close is still waiting to run: the sheet is simply
        // open, and a later unasked dismiss must be able to take it down.
        if (!closePending.current) reopen.current = false;
        unlisted.current?.();
        unlisted.current = sheetShowing(() => hideNow.current());
      });
    },
    hide,
    /** For the Modal's `onDismiss`. */
    onDismiss: gone,
  };
}
