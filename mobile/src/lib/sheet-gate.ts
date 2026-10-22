import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

/**
 * One rule for every sheet in the app (a React Native Modal): none is shown
 * while another is still being taken down. iOS presents a sheet from the
 * screen under it, and cannot while that screen is still dismissing another:
 * the new one is refused, never shows, and — its `visible` already true —
 * every later tap on its button changed nothing, so the button stayed dead
 * until the screen was left (Filters tapped as the order's card faded, a
 * second picker tapped as the first slid away).
 *
 * So each sheet that starts closing is counted until iOS says it has gone
 * (its Modal's onDismiss) or, whatever iOS says, a moment later; and a sheet
 * asked for meanwhile waits for the count to come back to nought, then opens.
 */

/** Longer than a sheet's own closing slide or fade. */
export const CLOSING_MS = 700;

let closing = 0;
const waiting = new Set<() => void>();
/** The sheets showing now, each with how to close it. */
const showing = new Map<object, () => void>();
/** What waits for every sheet to have gone (leaveSheets). */
const leaving = new Set<() => void>();

function settle() {
  if (closing > 0) return;
  if (showing.size === 0 && leaving.size > 0) {
    const go = [...leaving];
    leaving.clear();
    for (const run of go) run();
  }
  const run = [...waiting];
  waiting.clear();
  for (const open of run) open();
}

/**
 * A sheet is showing; `close` takes it down. Returns what to call once it is
 * no longer showing — as it starts closing, whose own closing is then
 * counted (sheetClosing), or when it is taken away.
 */
export function sheetShowing(close: () => void): () => void {
  const token = {};
  showing.set(token, close);
  return () => {
    if (showing.delete(token)) settle();
  };
}

/**
 * Leaves every sheet before going somewhere else of the app's own accord — a
 * notification's page, a shortcut, the welcome after a session ended, a link:
 * opened while a sheet showed, the page was pushed under it unseen, and a
 * screen presented whole (the welcome, the sign-in) made iOS take the sheet
 * down without a word to it, after which its button did nothing. So each
 * sheet showing is closed, and `go` runs once all have gone — at once when
 * none shows, and a moment later whatever a sheet does (one that asks before
 * closing, say).
 */
export function leaveSheets(go: () => void): void {
  if (showing.size === 0 && closing === 0) {
    go();
    return;
  }
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    leaving.delete(run);
    go();
  };
  leaving.add(run);
  for (const close of [...showing.values()]) close();
  setTimeout(run, CLOSING_MS * 2);
  settle();
}

/** How many sheets are showing, for a link deciding whether it must wait for them. */
export function sheetsShowing(): number {
  return showing.size;
}

/**
 * A sheet has begun closing. Returns what to call once it has gone (its
 * onDismiss); called or not, it counts as gone a moment later. Elsewhere than
 * iOS a sheet is gone at once, and nothing waits.
 */
export function sheetClosing(): () => void {
  if (Platform.OS !== 'ios') return () => {};
  closing += 1;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    closing -= 1;
    settle();
  };
  const timer = setTimeout(finish, CLOSING_MS);
  return finish;
}

/** Runs `open` once no sheet is still closing — at once when none is. Returns how to call it off. */
export function whenSheetsSettled(open: () => void): () => void {
  if (closing === 0) {
    open();
    return () => {};
  }
  waiting.add(open);
  return () => {
    waiting.delete(open);
  };
}

/** Whether a sheet is still being taken down, for tests. */
export function sheetsClosingForTests(): number {
  return closing;
}

/** For tests: nothing closing, showing or waiting. */
export function resetSheetGateForTests() {
  closing = 0;
  waiting.clear();
  showing.clear();
  leaving.clear();
}

/**
 * A sheet whose being open is a plain flag (`wanted`) — a picker, the board's
 * filters — shown through the gate: `visible` for its Modal turns true only
 * once no other sheet is closing, and its own closing is counted until its
 * Modal's `onDismiss`. `close` is the owner's own way of closing it, for
 * leaveSheets.
 */
export function useGatedModal(wanted: boolean, close: () => void): { visible: boolean; onDismiss: () => void } {
  const [visible, setVisible] = useState(false);
  const shown = useRef(false);
  const gone = useRef<(() => void) | null>(null);
  // Showing, for leaveSheets: closed by the owner's own close.
  const unlisted = useRef<(() => void) | null>(null);
  const closeNow = useRef(close);
  useEffect(() => {
    closeNow.current = close;
  });

  useEffect(() => {
    if (wanted) {
      return whenSheetsSettled(() => {
        shown.current = true;
        setVisible(true);
        unlisted.current?.();
        unlisted.current = sheetShowing(() => closeNow.current());
      });
    }
    if (shown.current) {
      shown.current = false;
      setVisible(false);
      gone.current?.();
      gone.current = sheetClosing();
      unlisted.current?.();
      unlisted.current = null;
    }
    return undefined;
  }, [wanted]);

  useEffect(
    () => () => {
      unlisted.current?.();
      unlisted.current = null;
    },
    [],
  );

  return {
    visible,
    onDismiss: () => {
      gone.current?.();
      gone.current = null;
    },
  };
}
