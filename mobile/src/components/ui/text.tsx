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
 * `left` is the physical left on both the web and the phone: React Native does
 * not mirror it, and the web's CSS does not either. The website's `text-start`
 * is `start` on the web, which follows the page's direction. The phone's text
 * alignment has no `start`, so the physical edge is chosen from the app's
 * direction — `right` stays on the right when the phone itself is also right
 * to left, because nothing swaps it back.
 */
export function textAlignStart(os: string = Platform.OS, direction: 'rtl' | 'ltr' = appDirection): TextStyle['textAlign'] {
  if (os === 'web') return 'start' as TextStyle['textAlign'];
  return direction === 'rtl' ? 'right' : 'left';
}

/**
 * All text in the app. IBM Plex Sans Arabic, the website's type scale, and the
 * theme's colours. A line starts at the reading edge (textAlignStart), so an
 * Arabic label sits on the right on the web and on the phone.
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
