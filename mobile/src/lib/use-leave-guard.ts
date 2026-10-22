import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useTranslations } from 'use-intl';
import { dialog } from '~/lib/dialog';

/**
 * Asks before throwing away what was typed. What a form holds lives in the
 * screen alone, and a Back, a swipe from the edge or a sheet pulled down took
 * a listing's eight thousand characters with it, unasked.
 */
export function useConfirmDiscard() {
  const t = useTranslations();
  return useCallback(
    (discard: () => void) =>
      dialog.alert(t('app.leave.title'), t('app.leave.body'), [
        { text: t('app.leave.stay'), style: 'cancel' },
        { text: t('app.leave.discard'), style: 'destructive', onPress: discard },
      ]),
    [t],
  );
}

/** How many screens hold typed work right now: what the update gate waits for (UpdateGate). */
let held = 0;
const watchers = new Set<() => void>();
function holdBy(change: number) {
  held += change;
  for (const watcher of watchers) watcher();
}

/** Counts this screen as holding typed work while `holding`. */
export function useHoldsWork(holding: boolean) {
  useEffect(() => {
    if (!holding) return;
    holdBy(1);
    return () => holdBy(-1);
  }, [holding]);
}

/** Whether any screen holds typed work that leaving would throw away. */
export function useWorkInProgress(): boolean {
  return useSyncExternalStore(
    (watcher) => {
      watchers.add(watcher);
      return () => {
        watchers.delete(watcher);
      };
    },
    () => held > 0,
  );
}

/**
 * The same question for leaving the screen itself, while `dirty`. While
 * `sending`, the screen is held instead, and says why: what was typed is on its
 * way, leaving would not stop it, only hide how it went — and "not saved, will
 * be lost" would not be true. `onDiscard` runs when the person chooses to throw
 * the work away, so a draft kept on the phone goes with it.
 */
export function useLeaveGuard(dirty: boolean, sending = false, onDiscard?: () => void) {
  const t = useTranslations();
  const confirm = useConfirmDiscard();
  // Told to throw the work away, the screen stops holding itself and makes the
  // leave it held back. Since SDK 58 the same action sent again is held again
  // while the screen still prevents its removal, and Discard did nothing.
  const [discarded, setDiscarded] = useState(false);
  const holding = !discarded && (dirty || sending);
  useHoldsWork(holding);
  usePreventRemove(holding, ({ repeat }) => {
    if (sending) {
      dialog.alert(t('app.leave.sendingTitle'), t('app.leave.sendingBody'), [{ text: t('app.leave.stay'), style: 'cancel' }]);
      return;
    }
    confirm(() => {
      // Discarded on purpose: whatever the form kept of it goes too (use-kept-draft.ts).
      onDiscard?.();
      setDiscarded(true);
      repeat();
    });
  });
}
