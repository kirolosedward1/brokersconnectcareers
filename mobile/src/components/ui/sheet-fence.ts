import { useState } from 'react';
import { PanResponder, type GestureResponderHandlers } from 'react-native';

/**
 * Touch handlers for a sheet's outermost view (the first child of its Modal).
 *
 * React Native settles who handles a touch along the React tree, not the
 * screen's views, and a Modal's content sits in the tree where the Modal is
 * written: a sheet drawn inside a row or a card is, to the touch system,
 * inside that row. A tap on the sheet's blank space went on to the card's
 * link, and a sideways drag in it to the row's swipe — the stage picker and
 * the saved replies are drawn inside an applicant's row, which swipes to
 * shortlist or turn down.
 *
 * So the sheet keeps its touches: a tap nothing in it takes stops here, and
 * so does a drag that runs sideways (taken before the rows' own swipes would
 * take it — 12 and 14 points), never handed on. Taps on its buttons and its
 * lists' scrolling are the sheet's own and are untouched; a drag up or down
 * is not taken.
 */
export function useSheetFence(): GestureResponderHandlers {
  const [fence] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => sideways(gesture),
      onPanResponderTerminationRequest: () => false,
    }),
  );
  return fence.panHandlers;
}

/** A drag that runs sideways, far enough to be one: what a row or a card would take for a swipe. */
export function sideways(gesture: { dx: number; dy: number }): boolean {
  return Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2;
}
