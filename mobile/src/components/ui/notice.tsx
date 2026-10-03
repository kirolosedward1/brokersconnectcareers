import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { CheckCircle2, CircleAlert, TriangleAlert } from '~/components/ui/lucide';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';
import { Text } from './text';

/**
 * A boxed message — the website's success and error panels: a soft tint of
 * its meaning rather than an outline in it, the meaning carried by the title
 * and the icon too, never by the colour alone. `destructive` is announced as
 * it appears, the way the website's role="alert" is.
 *
 * A success, warning or error without an icon of its own gets its tone's, in
 * the tone's colour: the tint alone is barely darker than the page (1.1:1),
 * and an error without a title read as one more line of text.
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
  const mark =
    icon ??
    (tone === 'success' ? (
      <CheckCircle2 size={16} color={colors.success} />
    ) : tone === 'destructive' ? (
      <CircleAlert size={16} color={colors.destructive} />
    ) : tone === 'warning' ? (
      <TriangleAlert size={16} color={colors.warning} />
    ) : null);
  const body =
    typeof children === 'string' ? (
      <Text variant="small" style={{ color: palette.text }}>
        {children}
      </Text>
    ) : (
      children
    );

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
          {mark}
          <Text variant="small" weight="semibold" style={{ color: palette.text, flexShrink: 1 }}>
            {title}
          </Text>
        </View>
      ) : null}
      {title || !mark ? (
        body
      ) : (
        // No title: the mark beside the words, level with their first line.
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
          <View style={{ marginTop: 4 }}>{mark}</View>
          <View style={{ flex: 1 }}>{body}</View>
        </View>
      )}
    </View>
  );
}
