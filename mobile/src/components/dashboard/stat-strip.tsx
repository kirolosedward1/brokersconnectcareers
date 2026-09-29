import { Pressable, View } from 'react-native';
import { TrendingDown, TrendingUp } from 'lucide-react-native';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';

export type StatTone = 'default' | 'accent' | 'good' | 'warn' | 'urgent';

export type StatCell = {
  label: string;
  value: string;
  tone?: StatTone;
  /** Beside the figure, quieter: what a change is measured against. */
  hint?: string;
  /** A change, drawn only when there is one. */
  delta?: { value: string; direction: 'up' | 'down' | 'flat' };
  onPress: () => void;
};

/**
 * Dashboard figures as one ruled strip — the website's StatStrip, two across
 * as it is on a phone. Every figure is a way to where it can be acted on, and
 * a state is said before the digit is read: the figure takes the tone's colour
 * and the label gets a dot, so a warning is not carried by colour alone. An
 * odd last figure takes the whole row rather than sit beside a hole.
 */
export function StatStrip({ cells, label }: { cells: StatCell[]; label: string }) {
  const { colors } = useTheme();

  const rows: StatCell[][] = [];
  for (let index = 0; index < cells.length; index += 2) rows.push(cells.slice(index, index + 2));

  return (
    <View
      accessibilityLabel={label}
      style={{
        gap: 1,
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.border,
        // The hairlines are the ground showing through the gaps.
        backgroundColor: colors.border,
        overflow: 'hidden',
      }}
    >
      {rows.map((row) => (
        <View key={row[0].label} style={{ flexDirection: 'row', gap: 1 }}>
          {row.map((cell) => (
            <Cell key={cell.label} cell={cell} />
          ))}
        </View>
      ))}
    </View>
  );
}

function Cell({ cell }: { cell: StatCell }) {
  const { colors } = useTheme();
  // `figure`, not `value`: Reanimated's Babel plugin takes `x.value` inside a style for a shared value.
  const tone = {
    default: { figure: colors.foreground, dot: null },
    accent: { figure: colors.primary, dot: colors.primary },
    good: { figure: colors.success, dot: colors.success },
    warn: { figure: colors.foreground, dot: colors.warning },
    urgent: { figure: colors.destructive, dot: colors.destructive },
  }[cell.tone ?? 'default'];

  const moved = cell.delta && cell.delta.direction !== 'flat' ? cell.delta : null;
  const Trend = moved?.direction === 'down' ? TrendingDown : TrendingUp;
  const trendColor = moved?.direction === 'down' ? colors.destructive : colors.success;
  // A status word is a label, not a quantity: smaller than a figure.
  const isFigure = /[0-9٠-٩]/.test(cell.value);

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[`${cell.label}: ${cell.value}`, moved ? `${moved.value} ${cell.hint ?? ''}`.trim() : null]
        .filter(Boolean)
        .join('، ')}
      onPress={cell.onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 68,
        justifyContent: 'center',
        paddingHorizontal: space[4],
        paddingVertical: space[2],
        backgroundColor: pressed ? colors.muted : colors.card,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {tone.dot ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone.dot }} /> : null}
        <Text variant="caption" tone="mutedForeground" style={{ flexShrink: 1 }}>
          {cell.label}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: space[2] }}>
        <Text variant={isFigure ? 'title' : 'small'} weight="bold" style={{ color: tone.figure }}>
          {cell.value}
        </Text>
        {moved ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Trend size={12} color={trendColor} />
            <Text variant="caption" weight="medium" style={{ color: trendColor }}>
              {moved.value}
            </Text>
          </View>
        ) : null}
        {moved && cell.hint ? (
          <Text variant="caption" tone="mutedForeground">
            {cell.hint}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
