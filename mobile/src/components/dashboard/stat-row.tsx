import { View } from 'react-native';
import { Appear } from '~/components/motion/appear';
import { Pulse } from '~/components/motion/pulse';
import type { LucideIcon } from '~/components/ui/lucide';
import { PressableScale } from '~/components/ui/pressable-scale';
import { Text } from '~/components/ui/text';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, motion, space } from '~/theme/tokens';
import type { StatTone } from './stat-strip';

export type StatRowCell = {
  /** The figure's full name, for VoiceOver ("طلبات التقديم"). */
  label: string;
  /** Its one word under the figure ("طلباتي"). */
  short: string;
  value: string;
  icon: LucideIcon;
  tone?: StatTone;
  onPress: () => void;
};

/**
 * The candidate's figures in one quiet row: an icon in a soft circle, the
 * figure, one word under it. Each is a way to where it can be acted on. A
 * state takes the circle's colour and the figure's, never colour alone: the
 * word under it says what is counted, VoiceOver reads the full name.
 * They arrive a beat apart, from the side the reading starts on.
 *
 * At the accessibility text sizes the words are not shrunk to fit a quarter
 * of the row: the cells stack, each a line of its own (large-text.ts).
 */
export function StatRow({ cells, label }: { cells: StatRowCell[]; label: string }) {
  const { colors, shadow } = useTheme();
  const large = useLargeText();
  return (
    <View
      accessibilityLabel={label}
      style={{
        flexDirection: large ? 'column' : 'row',
        paddingVertical: space[3],
        paddingHorizontal: space[1],
        ...corner('xl'),
        backgroundColor: colors.card,
        boxShadow: shadow.card,
      }}
    >
      {cells.map((cell, index) => (
        <Appear key={cell.label} delay={index * motion.stagger} from="below" distance={8} style={large ? undefined : { flex: 1 }}>
          <Cell cell={cell} large={large} />
        </Appear>
      ))}
    </View>
  );
}

function Cell({ cell, large }: { cell: StatRowCell; large: boolean }) {
  const { colors } = useTheme();
  // `ink`, not `value`: Reanimated's Babel plugin takes `x.value` inside a style for a shared value.
  const tone = {
    default: { ground: colors.secondary, ink: colors.primary, figure: colors.foreground },
    accent: { ground: colors.accent, ink: colors.accentForeground, figure: colors.primary },
    good: { ground: colors.successMuted, ink: colors.success, figure: colors.success },
    warn: { ground: colors.warningMuted, ink: colors.warning, figure: colors.warning },
    urgent: { ground: colors.destructiveMuted, ink: colors.destructive, figure: colors.destructive },
  }[cell.tone ?? 'default'];
  const Icon = cell.icon;

  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityLabel={`${cell.label}: ${cell.value}`}
      onPress={cell.onPress}
      style={({ pressed }) => ({
        flexDirection: large ? 'row' : 'column',
        alignItems: 'center',
        gap: large ? space[3] : space[1],
        paddingVertical: space[1],
        paddingHorizontal: large ? space[2] : 0,
        marginHorizontal: 2,
        ...corner('lg'),
        backgroundColor: pressed ? colors.muted : 'transparent',
      })}
    >
      <View style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center', ...corner('full'), backgroundColor: tone.ground }}>
        <Icon size={18} color={tone.ink} strokeWidth={2} />
      </View>
      <Text
        variant="headline"
        weight="bold"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        maxFontSizeMultiplier={2}
        style={{ color: tone.figure, fontVariant: ['tabular-nums'], marginTop: large ? 0 : 2 }}
      >
        {cell.value}
      </Text>
      <Text
        variant="label"
        tone="mutedForeground"
        numberOfLines={2}
        maxFontSizeMultiplier={2}
        style={large ? { flex: 1, textAlign: 'left' } : { textAlign: 'center', marginTop: -4 }}
      >
        {cell.short}
      </Text>
    </PressableScale>
  );
}

/**
 * The row before its figures are read: the same card, each cell's circle and
 * two bars in the page's muted tone, breathing — where the figures will land,
 * rather than a spinner. Said as "loading" to VoiceOver.
 */
export function StatRowPlaceholder({ count, label }: { count: number; label: string }) {
  const { colors, shadow } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        paddingVertical: space[4],
        paddingHorizontal: space[1],
        ...corner('xl'),
        backgroundColor: colors.card,
        boxShadow: shadow.card,
      }}
    >
      {Array.from({ length: count }, (_, index) => (
        <Pulse key={index} phase={index * 140} style={{ flex: 1, alignItems: 'center', gap: space[2] }}>
          <View style={{ width: 38, height: 38, ...corner('full'), backgroundColor: colors.muted }} />
          <View style={{ width: 24, height: 14, borderRadius: 7, backgroundColor: colors.muted }} />
          <View style={{ width: 36, height: 8, borderRadius: 4, backgroundColor: colors.muted }} />
        </Pulse>
      ))}
    </View>
  );
}
