import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type PressableProps } from 'react-native';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, space } from '~/theme/tokens';
import { PressableScale } from './pressable-scale';
import { Text } from './text';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'champagne' | 'glass';

type Props = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: Variant;
  size?: 'default' | 'sm' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  /** A cap on how far the label grows with the text size: for a button in a bar of fixed height. */
  maxFontSizeMultiplier?: number;
};

/** White over a dark picture, as much of it as lets the picture through: a control's fill, pressed, and edge. */
export const GLASS = {
  fill: 'rgba(255, 255, 255, 0.14)',
  pressed: 'rgba(255, 255, 255, 0.26)',
  edge: 'rgba(255, 255, 255, 0.32)',
} as const;

/**
 * A capsule, never smaller than a finger: 48 points by default, 56 for the
 * one thing a screen is for, 36 (with slop to 44) beside other controls.
 * Primary is ink-blue in light and champagne in dark; champagne is champagne
 * in both, for the one action on the deep hero panel; outline is a quiet
 * surface with a hairline; ghost is the label alone; glass is see-through,
 * white on a hairline, for beside it over a photograph or the hero.
 */
export function Button({
  label,
  variant = 'primary',
  size = 'default',
  loading = false,
  icon,
  disabled,
  style,
  maxFontSizeMultiplier,
  ...props
}: Props) {
  const { colors, lift, scheme } = useTheme();
  const height = size === 'sm' ? 36 : size === 'lg' ? 56 : hitTarget + 4;

  const fill = {
    primary: { background: colors.primary, pressed: colors.primaryPressed, text: colors.primaryForeground, border: 'transparent' },
    secondary: { background: colors.secondary, pressed: colors.muted, text: colors.secondaryForeground, border: 'transparent' },
    outline: { background: colors.card, pressed: colors.muted, text: colors.foreground, border: colors.border },
    ghost: { background: 'transparent', pressed: colors.muted, text: colors.foreground, border: 'transparent' },
    destructive: { background: colors.destructive, pressed: colors.destructive, text: colors.destructiveForeground, border: 'transparent' },
    champagne: { background: colors.champagne, pressed: colors.champagnePressed, text: colors.champagneForeground, border: 'transparent' },
    glass: { background: GLASS.fill, pressed: GLASS.pressed, text: colors.onHero, border: GLASS.edge },
  }[variant];

  const inactive = disabled || loading;
  // The primary button sits on the page in light; in dark, its fill is the lift.
  // A small one beside other controls stays flat: it repeats down lists (the applicants').
  const lifted = variant === 'primary' && scheme === 'light' && !inactive && size !== 'sm';

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inactive), busy: loading }}
      disabled={inactive}
      hitSlop={size === 'sm' ? 4 : 0}
      {...props}
      style={(state) => [
        {
          minHeight: height,
          paddingHorizontal: size === 'sm' ? space[4] : space[5],
          ...corner('full'),
          borderWidth: variant === 'outline' || variant === 'glass' ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: fill.border,
          backgroundColor: state.pressed ? fill.pressed : fill.background,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: inactive && !loading ? 0.45 : 1,
        },
        lifted ? lift : null,
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      {/* The label wraps within the fill at the largest text sizes, rather than running past it. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], maxWidth: '100%' }}>
        {loading ? <ActivityIndicator color={fill.text} /> : icon}
        <Text
          weight="semibold"
          variant={size === 'sm' ? 'small' : 'body'}
          maxFontSizeMultiplier={maxFontSizeMultiplier}
          style={{ color: fill.text, flexShrink: 1, textAlign: 'center' }}
        >
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}
