import { Children, type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type TextStyle } from 'react-native';
import { hitTarget } from '~/theme/tokens';
import { Text } from './text';

/**
 * A link inside a sentence. Text with an onPress is only as tall as its line —
 * a caption is 20 points — so the words sit in a 44-point target, the same
 * size as a link on a line of its own (text-link.tsx). `hitSlop` covers the
 * rest of a short word.
 */
export function InlineLink({
  children,
  onPress,
  variant = 'small',
  tone = 'primary',
  weight = 'semibold',
  color,
}: {
  children: ReactNode;
  onPress: () => void;
  variant?: 'small' | 'caption';
  tone?: 'primary' | 'foreground';
  weight?: 'semibold' | 'medium';
  /** A colour that is not one of the tones, such as champagne on the welcome. */
  color?: string;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        minWidth: hitTarget,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text variant={variant} weight={weight} tone={tone} style={color ? { color } : undefined}>
        {children}
      </Text>
    </Pressable>
  );
}

/**
 * The sentence those links sit in. A row that wraps, centred, so each link is
 * its own target and a long clause still breaks onto the next line.
 */
export function LinkLine({
  children,
  variant = 'caption',
  tone = 'mutedForeground',
  style,
}: {
  children: ReactNode;
  variant?: 'small' | 'caption';
  tone?: 'mutedForeground' | 'foreground';
  style?: StyleProp<TextStyle>;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
      {Children.map(children, (child, index) =>
        typeof child === 'string' || typeof child === 'number' ? (
          <Text key={index} variant={variant} tone={tone} style={[{ maxWidth: '100%' }, style]}>
            {child}
          </Text>
        ) : (
          child
        ),
      )}
    </View>
  );
}
