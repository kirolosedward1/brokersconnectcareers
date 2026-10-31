import { Children, useRef, type ReactNode } from 'react';
import { ScrollView, type ScrollViewInstance, type StyleProp, type ViewStyle } from 'react-native';
import { appDirection } from '~/lib/direction';
import { space } from '~/theme/tokens';

/**
 * Chips in one row that slides sideways (owner's call, 31 Oct: "carousel
 * style, in one row"), its first chip at the reading edge.
 *
 * A horizontal scroll under a right-to-left app opened at the wrong end in
 * Expo Go, which lays the screen out left to right while the app reads right
 * to left (src/lib/direction.ts): the first chips sat off the screen. So the
 * row is laid out left to right whatever the phone does, its chips in reverse
 * when the app reads right to left, and it opens scrolled to its far end —
 * the first chip at the right, the rest a swipe to the right away. The same
 * on every phone, store build or Expo Go.
 */
export function SideRow({
  children,
  label,
  bleed = 0,
  style,
}: {
  children: ReactNode;
  label?: string;
  /** The page's side margin, so the row runs out to the screen's edges. */
  bleed?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<ScrollViewInstance>(null);
  const rtl = appDirection === 'rtl';
  const items = Children.toArray(children).filter(Boolean);
  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      accessibilityLabel={label}
      // Its own direction, so the far end is where this code says it is.
      style={[{ direction: 'ltr', flexGrow: 0, marginHorizontal: -bleed }, style]}
      contentContainerStyle={{ gap: space[2], paddingHorizontal: bleed, alignItems: 'center' }}
      // Right to left: open at the far end, where the first chip is; again whenever the chips change.
      onContentSizeChange={rtl ? () => ref.current?.scrollToEnd({ animated: false }) : undefined}
    >
      {rtl ? items.slice().reverse() : items}
    </ScrollView>
  );
}
