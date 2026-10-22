import { useState } from 'react';
import { LayoutAnimation } from 'react-native';
import { useReduceMotion } from '~/theme/reduce-motion';

/** Short, and eased at both ends: rows closing up, not sliding about. */
const CHANGE = {
  duration: 260,
  create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};

/**
 * For a short list drawn row by row (not a FlashList, which recycles its
 * rows): when what is in it changes — a listing hidden, an application
 * withdrawn and moved under "decided", a bookmark taken off — the rows move
 * to their new places and fade in or out, rather than jumping. `ids` is
 * what the list holds, in order. Not on its first drawing, and not with
 * Reduce Motion on.
 */
export function useListMotion(ids: readonly string[]) {
  const reduceMotion = useReduceMotion();
  const key = ids.join('|');
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    if (!reduceMotion) LayoutAnimation.configureNext(CHANGE);
  }
}
