import type { ReactNode } from 'react';
import { Pressable, View, type AccessibilityActionEvent, type AccessibilityActionInfo, type ViewStyle } from 'react-native';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';

/**
 * The website's card: a border, no shadow, 10-point corners. Pressable when
 * given onPress. A pressable card is one element to VoiceOver, so a second
 * control inside it (a listing's bookmark) is offered as an action on the card.
 */
export function Card({
  children,
  onPress,
  accessibilityLabel,
  accessibilityActions,
  onAccessibilityAction,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const base: ViewStyle = {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.card,
    padding: space[4],
  };

  if (!onPress) return <View style={[base, style]}>{children}</View>;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      onPress={onPress}
      style={({ pressed }) => [base, pressed && { backgroundColor: colors.muted }, style]}
    >
      {children}
    </Pressable>
  );
}
