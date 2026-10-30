import { View } from 'react-native';
import { Num } from '~/components/ui/num';
import { Text } from '~/components/ui/text';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';

export type FigureTile = {
  label: string;
  value: number;
  percent?: boolean;
  /** One line under the label: what the figure is out of, or measured against. */
  hint?: string | null;
};

/**
 * Figures to read rather than tap (ListingStats, the admin's numbers): a
 * card each, the figure first in the line's direction — at the right, in
 * Arabic — in tabular digits, its name under it. One element each to
 * VoiceOver, name then figure. At the accessibility sizes, two to a row.
 */
export function FigureTiles({ tiles, label }: { tiles: FigureTile[]; label: string }) {
  const { colors, lift } = useTheme();
  const large = useLargeText();
  return (
    <View accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
      {tiles.map((tile) => (
        <View
          key={tile.label}
          accessible
          testID="figure-tile"
          style={{
            flexGrow: 1,
            flexBasis: large ? '45%' : 0,
            gap: space[0.5],
            padding: space[3],
            ...corner('xl'),
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            ...lift,
          }}
        >
          <Num value={tile.value} percent={tile.percent} variant="title" weight="bold" tone="primary" />
          <Text variant="caption" weight="medium" tone="mutedForeground">
            {tile.label}
          </Text>
          {tile.hint ? (
            <Text variant="caption" tone="mutedForeground">
              {tile.hint}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
