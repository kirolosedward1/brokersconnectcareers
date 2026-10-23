import { Platform, Text as NativeText, type TextProps, type TextStyle } from 'react-native';
import { appDirection } from '~/lib/direction';
import { useTheme } from '~/theme/provider';
import { font, type as scale } from '~/theme/tokens';
import type { Colors } from '~/theme/tokens';

type Props = TextProps & {
  variant?: keyof typeof scale;
  weight?: keyof typeof font;
  tone?: keyof Colors;
};

/**
 * Where a line of text starts.
 *
 * On the phone, `left` is the logical start: while I18nManager is right to
 * left (the app forces that), React Native swaps `left` and `right` itself.
 * Writing `right` here as well draws Arabic on the left.
 *
 * On the web nothing swaps, and react-native-web maps CSS `start` to the
 * physical left when the page has no RTL context, so Arabic uses `right`.
 */
export function textAlignStart(
  os: string = Platform.OS,
  direction: 'rtl' | 'ltr' = appDirection,
): TextStyle['textAlign'] {
  if (os === 'web') return direction === 'rtl' ? 'right' : 'left';
  return 'left';
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
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (variant === 'display' ? 2 : undefined)}
      style={[{ fontFamily: font[weight], color: colors[tone], textAlign: textAlignStart() }, scale[variant], style]}
    />
  );
}
