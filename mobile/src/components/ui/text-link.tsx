import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { hitTarget } from '~/theme/tokens';
import { Text } from './text';

/**
 * A link on a line of its own ("Forgot your password?"): the words in the
 * brand colour, in a target a finger can find. Text with an onPress is only
 * as tall as its line — some 24 points, half of what a finger needs — and
 * gives no sign it was touched; this is 44 tall, the words in its middle, and
 * fades a little while held, as a section's "All jobs ›" does.
 *
 * A link inside a sentence stays Text, where it belongs to its words.
 */
export function TextLink({
  label,
  onPress,
  variant = 'small',
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'small' | 'body';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [
        { minHeight: hitTarget, justifyContent: 'center', alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 },
        style,
      ]}
    >
      <Text variant={variant} weight="semibold" tone="primary">
        {label}
      </Text>
    </Pressable>
  );
}
