import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { CLOSING_MS, sheetClosing, whenSheetsSettled } from './sheet-gate';

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

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      opening.current?.();
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
    setMounted(false);
    closed.current?.();
    closed.current = null;
    const next = then.current;
    then.current = null;
    next?.();
  };

  return {
    open,
    /** Whether to draw the sheet at all: while open, and while it closes. */
    mounted: open || mounted,
    show() {
      if (open) return;
      opening.current?.();
      opening.current = whenSheetsSettled(() => {
        opening.current = null;
        setMounted(true);
        setOpen(true);
      });
    },
    /** Closes it; `after` runs once it has gone. (Handed to onPress, it is given an event: only a function is kept.) */
    hide(after?: unknown) {
      const next = typeof after === 'function' ? (after as () => void) : null;
      opening.current?.();
      opening.current = null;
      if (!open) {
        next?.();
        return;
      }
      setOpen(false);
      if (Platform.OS !== 'ios') {
        setMounted(false);
        next?.();
        return;
      }
      if (next) then.current = next;
      closed.current?.();
      closed.current = sheetClosing();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(gone, CLOSING_MS);
    },
    /** For the Modal's `onDismiss`. */
    onDismiss: gone,
  };
}
