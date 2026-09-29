import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';
import { Text } from './text';

/**
 * A boxed message — the website's success and error panels. `destructive` is
 * announced as it appears, the way the website's role="alert" is.
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
    success: { background: colors.successMuted, border: colors.success, text: colors.foreground },
    destructive: { background: colors.destructiveMuted, border: colors.destructive, text: colors.foreground },
    warning: { background: colors.warningMuted, border: colors.warning, text: colors.foreground },
    muted: { background: colors.muted, border: colors.border, text: colors.foreground },
  }[tone];

  return (
    <View
      accessibilityRole={tone === 'destructive' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'destructive' ? 'polite' : undefined}
      style={{
        gap: space[1],
        padding: space[4],
        borderRadius: radius.xl,
        borderWidth: 1,
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
