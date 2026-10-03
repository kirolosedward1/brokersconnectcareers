import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';
import { Text } from './text';

/**
 * A boxed message — the website's success and error panels: a soft tint of
 * its meaning rather than an outline in it, the meaning carried by the title
 * and the icon too, never by the colour alone. `destructive` is announced as
 * it appears, the way the website's role="alert" is.
 */
export function Notice({
  tone,
  title,
  children,
  icon,
}: {
  tone: 'success' | 'destructive' | 'warning' | 'muted';
  title?: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  const { colors } = useTheme();
  const palette = {
    success: { background: colors.successMuted, border: 'transparent', text: colors.foreground },
    destructive: { background: colors.destructiveMuted, border: 'transparent', text: colors.foreground },
    warning: { background: colors.warningMuted, border: 'transparent', text: colors.foreground },
    muted: { background: colors.card, border: colors.border, text: colors.foreground },
  }[tone];

  return (
    <View
      accessibilityRole={tone === 'destructive' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'destructive' ? 'polite' : undefined}
      style={{
        gap: space[1],
        paddingHorizontal: space[4],
        paddingVertical: space[3] + 2,
        ...corner('lg'),
        borderWidth: tone === 'muted' ? StyleSheet.hairlineWidth * 2 : 0,
        borderColor: palette.border,
        backgroundColor: palette.background,
      }}
    >
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          {icon}
          <Text variant="small" weight="semibold" style={{ color: palette.text, flexShrink: 1 }}>
            {title}
          </Text>
        </View>
      ) : null}
      {typeof children === 'string' ? (
        <Text variant="small" style={{ color: palette.text }}>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}
