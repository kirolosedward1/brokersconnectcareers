import { Text as NativeText, type TextProps } from 'react-native';
import { useTheme } from '~/theme/provider';
import { font, type as scale } from '~/theme/tokens';
import type { Colors } from '~/theme/tokens';

type Props = TextProps & {
  variant?: keyof typeof scale;
  weight?: keyof typeof font;
  tone?: keyof Colors;
};

/**
 * All text in the app. IBM Plex Sans Arabic, the website's type scale, and the
 * theme's colours.
 *
 * `textAlign: 'left'` is the logical start: with right-to-left forced, React
 * Native mirrors left to right, so Arabic sits at the right edge and a Latin
 * company name inside an Arabic list does too — as the website's `text-start`.
 */
export function Text({ variant = 'body', weight = 'regular', tone = 'foreground', style, ...props }: Props) {
  const { colors } = useTheme();
  return (
    <NativeText
      {...props}
      style={[{ fontFamily: font[weight], color: colors[tone], textAlign: 'left' }, scale[variant], style]}
    />
  );
}
