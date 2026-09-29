import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';
import { Text } from './text';

type Variant = 'default' | 'outline' | 'primary' | 'success' | 'warning' | 'destructive' | 'accent';

/** State, never decoration — the website's rule for badges. */
export function Badge({ label, variant = 'default', icon }: { label: string; variant?: Variant; icon?: ReactNode }) {
  const { colors } = useTheme();
  const tone = {
    default: { background: colors.muted, text: colors.mutedForeground, border: 'transparent' },
    outline: { background: 'transparent', text: colors.foreground, border: colors.border },
    primary: { background: colors.secondary, text: colors.primary, border: 'transparent' },
    success: { background: colors.successMuted, text: colors.success, border: 'transparent' },
    warning: { background: colors.warningMuted, text: colors.warning, border: 'transparent' },
    destructive: { background: colors.destructiveMuted, text: colors.destructive, border: 'transparent' },
    accent: { background: colors.accent, text: colors.accentForeground, border: 'transparent' },
  }[variant];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1],
        alignSelf: 'flex-start',
        paddingHorizontal: space[2],
        paddingVertical: 2,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: tone.border,
        backgroundColor: tone.background,
      }}
    >
      {icon}
      <Text variant="caption" weight="medium" style={{ color: tone.text }}>
        {label}
      </Text>
    </View>
  );
}
