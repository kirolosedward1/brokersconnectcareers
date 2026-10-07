import { Pressable, View } from 'react-native';
import { useTheme } from '~/theme/provider';
import { hitTarget, space } from '~/theme/tokens';
import { ForwardChevron } from './icons';
import { Text } from './text';

/**
 * A section's title, and at its end the way to all of it ("All jobs ›") when
 * there is one.
 */
export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
      <Text variant="title" weight="semibold" accessibilityRole="header" style={{ flexShrink: 1 }}>
        {title}
      </Text>
      {action && onAction ? (
        <Pressable
          accessibilityRole="link"
          onPress={onAction}
          hitSlop={8}
          style={({ pressed }) => ({ minHeight: hitTarget, flexDirection: 'row', alignItems: 'center', gap: 2, opacity: pressed ? 0.6 : 1 })}
        >
          <Text variant="small" weight="semibold" tone="primary">
            {action}
          </Text>
          <ForwardChevron size={16} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}
