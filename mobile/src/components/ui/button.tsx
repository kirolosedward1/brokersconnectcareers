import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, type PressableProps, View } from 'react-native';
import { useTheme } from '~/theme/provider';
import { hitTarget, radius, space } from '~/theme/tokens';
import { Text } from './text';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';

type Props = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: Variant;
  size?: 'default' | 'sm' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
};

/** The website's button: 44 points tall by default, never smaller than a finger. */
export function Button({ label, variant = 'primary', size = 'default', loading = false, icon, disabled, style, ...props }: Props) {
  const { colors } = useTheme();
  const height = size === 'sm' ? 36 : size === 'lg' ? 52 : hitTarget;

  const fill = {
    primary: { background: colors.primary, pressed: colors.primaryPressed, text: colors.primaryForeground, border: 'transparent' },
    secondary: { background: colors.secondary, pressed: colors.muted, text: colors.secondaryForeground, border: 'transparent' },
    outline: { background: 'transparent', pressed: colors.muted, text: colors.foreground, border: colors.border },
    ghost: { background: 'transparent', pressed: colors.muted, text: colors.foreground, border: 'transparent' },
    destructive: { background: colors.destructive, pressed: colors.destructive, text: colors.destructiveForeground, border: 'transparent' },
  }[variant];

  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inactive), busy: loading }}
      disabled={inactive}
      hitSlop={size === 'sm' ? 4 : 0}
      {...props}
      style={(state) => [
        {
          minHeight: height,
          paddingHorizontal: space[4],
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: fill.border,
          backgroundColor: state.pressed ? fill.pressed : fill.background,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: inactive && !loading ? 0.5 : 1,
        },
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        {loading ? <ActivityIndicator color={fill.text} /> : icon}
        <Text weight="semibold" variant={size === 'sm' ? 'small' : 'body'} style={{ color: fill.text }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
