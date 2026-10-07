import { useRef, type RefObject } from 'react';
import { AccessibilityInfo, type ScrollView, type View } from 'react-native';
import { space } from '~/theme/tokens';

type Messages = Partial<Record<string, string | null | undefined>>;
type Measured = { measureLayout(relativeTo: unknown, onSuccess: (x: number, y: number) => void, onFail?: () => void): void };

/**
 * Field errors where they can be seen and heard.
 *
 * A form's button is at its bottom and each error under its field, higher up:
 * on a small phone, or with the keyboard up, out of sight — pressing the
 * button seemed to do nothing. And iOS reads no error out by itself: an
 * "alert" role has no trait there, and a live region is Android's.
 *
 * `place(name)` is the ref for the view around a field, named as its error
 * is. `show(errors)`, given what was just set, scrolls the first of them on
 * the page — by `order`, the fields top first — into view with its label, and
 * says it to VoiceOver. An error with no place (the form's own refusal, shown
 * by its button) is said without moving the page. `above` is what covers the
 * top of the scroll view: the status bar, on a page drawn without a header.
 */
export function useErrorsInView(scroll: RefObject<ScrollView | null>, order: readonly string[], { above = 0 }: { above?: number } = {}) {
  const views = useRef(new Map<string, View>());

  const place = (name: string) => (view: View | null) => {
    if (!view) return;
    views.current.set(name, view);
    return () => {
      if (views.current.get(name) === view) views.current.delete(name);
    };
  };

  const show = (errors: Messages) => {
    const named = Object.keys(errors).filter((name) => errors[name]);
    const first = order.find((name) => named.includes(name)) ?? named[0];
    if (!first) return;
    AccessibilityInfo.announceForAccessibilityWithOptions(errors[first] as string, { queue: true });

    // Measured once what was just set is drawn: the field may be on a step shown only now.
    requestAnimationFrame(() => {
      const view = views.current.get(first) as unknown as Measured | undefined;
      // The scroll view's content, which the field is measured against: its place on the page, wherever it is scrolled to.
      const content = (scroll.current as unknown as { getInnerViewRef?: () => unknown } | null)?.getInnerViewRef?.();
      if (!view || !content) return;
      view.measureLayout(content, (_x, y) => {
        scroll.current?.scrollTo({ y: Math.max(0, y - space[4] - above), animated: true });
      });
    });
  };

  return { place, show };
}
