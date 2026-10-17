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

function settle() {
  if (closing > 0) return;
  const run = [...waiting];
  waiting.clear();
  for (const open of run) open();
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

/** For tests: nothing closing, nothing waiting. */
export function resetSheetGateForTests() {
  closing = 0;
  waiting.clear();
}

/**
 * A sheet whose being open is a plain flag (`wanted`) — a picker, the board's
 * filters — shown through the gate: `visible` for its Modal turns true only
 * once no other sheet is closing, and its own closing is counted until its
 * Modal's `onDismiss`.
 */
export function useGatedModal(wanted: boolean): { visible: boolean; onDismiss: () => void } {
  const [visible, setVisible] = useState(false);
  const shown = useRef(false);
  const gone = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (wanted) {
      return whenSheetsSettled(() => {
        shown.current = true;
        setVisible(true);
      });
    }
    if (shown.current) {
      shown.current = false;
      setVisible(false);
      gone.current?.();
      gone.current = sheetClosing();
    }
    return undefined;
  }, [wanted]);

  return {
    visible,
    onDismiss: () => {
      gone.current?.();
      gone.current = null;
    },
  };
}
