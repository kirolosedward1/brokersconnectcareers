import { ScrollView, View } from 'react-native';

/**
 * Layout, which a test renderer has none of: every view measured against a
 * scroll view's content is `y` points down it. Returns the scroll views'
 * shared `scrollTo` (React Native's stand-in holds one mock for them all),
 * cleared, to see where a form was scrolled to, and the way to undo it all.
 */
export function placeViewsAt(y: number) {
  const content = { content: true };
  const inner = jest.spyOn(ScrollView.prototype as unknown as { getInnerViewRef: () => unknown }, 'getInnerViewRef').mockReturnValue(content);
  const measure = jest
    .spyOn(View.prototype as unknown as { measureLayout: (...args: unknown[]) => void }, 'measureLayout')
    .mockImplementation((relativeTo: unknown, onSuccess: unknown) => {
      if (relativeTo === content) (onSuccess as (x: number, y: number) => void)(0, y);
    });
  const scrollTo = jest.spyOn(ScrollView.prototype as unknown as { scrollTo: (...args: unknown[]) => void }, 'scrollTo');
  scrollTo.mockClear();
  return {
    scrollTo,
    undo: () => {
      // Back to React Native's stand-ins, which measure nothing.
      inner.mockReset();
      measure.mockReset();
    },
  };
}
