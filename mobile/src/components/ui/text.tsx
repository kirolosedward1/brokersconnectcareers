import { I18nManager, Platform, Text as NativeText, type TextProps, type TextStyle } from 'react-native';
import { drawnDirection } from '~/lib/direction';
import { useTheme } from '~/theme/provider';
import { font, type as scale } from '~/theme/tokens';
import type { Colors } from '~/theme/tokens';

type Props = TextProps & {
  variant?: keyof typeof scale;
  weight?: keyof typeof font;
  tone?: keyof Colors;
};

/**
 * Where a line of text starts: the right while the app is Arabic, the left
 * in English. The language says which (src/lib/direction.ts), not the
 * direction the screen was created in. Expo Go can come up left to right
 * while the app is still Arabic, and a `left` written for the phone to
 * mirror then stays on the left.
 *
 * On the phone, while I18nManager is right to left, React Native swaps
 * `left` and `right` once. The value returned is the side that lands on the
 * reading edge after that swap. Returning `right` while the phone is already
 * swapping would put Arabic back on the left. The web does not swap, and
 * react-native-web maps `start` to the physical left, so the physical side
 * is written there directly.
 */
export function textAlignStart(
  os: string = Platform.OS,
  direction: 'rtl' | 'ltr' = drawnDirection(),
  mirrored: boolean = I18nManager.isRTL,
): TextStyle['textAlign'] {
  const edge: 'left' | 'right' = direction === 'rtl' ? 'right' : 'left';
  if (os !== 'web' && mirrored) return edge === 'right' ? 'left' : 'right';
  return edge;
}

/**
 * Where a line of text ends. The same language and the same swap as
 * textAlignStart, so the end does not get flipped a second time either.
 */
export function textAlignEnd(
  os: string = Platform.OS,
  direction: 'rtl' | 'ltr' = drawnDirection(),
  mirrored: boolean = I18nManager.isRTL,
): TextStyle['textAlign'] {
  const edge: 'left' | 'right' = direction === 'rtl' ? 'left' : 'right';
  if (os !== 'web' && mirrored) return edge === 'right' ? 'left' : 'right';
  return edge;
}

/**
 * All text in the app. IBM Plex Sans Arabic, the website's type scale, and the
 * theme's colours. A line starts at the reading edge (textAlignStart).
 */
export function Text({ variant = 'body', weight = 'regular', tone = 'foreground', style, maxFontSizeMultiplier, ...props }: Props) {
  const { colors } = useTheme();
  return (
    <NativeText
      {...props}
      // The display size grows to twice itself and stops, as iOS's own large
      // titles stop: beyond that a headline's longest word is wider than the
      // phone and breaks mid-word, which Arabic's joined letters cannot take.
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (variant === 'display' || variant === 'screen' ? 2 : undefined)}
      style={[{ fontFamily: font[weight], color: colors[tone], textAlign: textAlignStart() }, scale[variant], style]}
    />
  );
}
