import type { ReactNode } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent, type AccessibilityActionInfo, type ViewStyle } from 'react-native';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';
import { PressableScale } from './pressable-scale';

/**
 * A surface raised off the page: white on the ivory in light, a lighter
 * charcoal in dark, with a hairline, a soft shadow and continuous 20-point
 * corners. Pressable when given onPress, settling a touch when held; held
 * longer, `onLongPress` (a listing's menu). A
 * pressable card is one element to VoiceOver, so a second control inside it
 * (a listing's bookmark) is offered as an action on the card.
 */
export function Card({
  children,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityActions,
  onAccessibilityAction,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
  style?: ViewStyle;
}) {
  const { colors, lift } = useTheme();
  const base: ViewStyle = {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.border,
    ...corner('xl'),
    backgroundColor: colors.card,
    // The cheap shadow (tokens.ts, `lifts`): cards are the rows of every long list.
    ...lift,
    padding: space[4],
  };

  if (!onPress) return <View style={[base, style]}>{children}</View>;

  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={320}
      scaleTo={0.985}
      style={({ pressed }) => [base, pressed && { backgroundColor: colors.muted }, style]}
    >
      {children}
    </PressableScale>
  );
}
