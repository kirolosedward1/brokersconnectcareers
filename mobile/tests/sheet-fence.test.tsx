import { renderHook } from '@testing-library/react-native';
import { sideways, useSheetFence } from '~/components/ui/sheet-fence';

/*
  A sheet is, to React Native's touch system, inside the row or card it is
  drawn in: a tap on its blank space went on to the card's link, and a
  sideways drag in it to the row's swipe. Each sheet's outermost view keeps
  them (src/components/ui/sheet-fence.ts).
*/

const touch = {} as never;

it('keeps a tap nothing in the sheet takes, and never hands a touch it holds to what is around it', () => {
  const { result } = renderHook(() => useSheetFence());
  expect(result.current.onStartShouldSetResponder?.(touch)).toBe(true);
  expect(result.current.onResponderTerminationRequest?.(touch)).toBe(false);
});

it('takes a sideways drag before a row or a card would take it for a swipe, and leaves one up or down to the sheet', () => {
  // The rows' swipe takes more than 12 points sideways, at 1.5 times the height; the board's card more than 14 at 1.6.
  for (const [dx, dy] of [[13, 0], [-13, 8], [15, 9], [-40, 25]]) expect(sideways({ dx, dy })).toBe(true);
  for (const [dx, dy] of [[0, 30], [4, 2], [10, 0], [11, 11], [-12, 12]]) expect(sideways({ dx, dy })).toBe(false);
});
