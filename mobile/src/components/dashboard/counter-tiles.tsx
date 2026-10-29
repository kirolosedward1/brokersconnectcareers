import { View } from 'react-native';
import { Appear } from '~/components/motion/appear';
import { Num } from '~/components/ui/num';
import { PressableScale } from '~/components/ui/pressable-scale';
import { Text } from '~/components/ui/text';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, motion, space } from '~/theme/tokens';

export type CounterTile = {
  /** The figure's full name, for VoiceOver ("طلبات التقديم"). */
  label: string;
  /** Its one word under the figure ("طلباتي"). */
  short: string;
  value: number;
  /** Good news in its colour (a reply from a company), said by its word too. */
  good?: boolean;
  onPress: () => void;
};

/**
 * Home's figures as the design draws them (Main): a card each, the figure
 * large in the primary ink — good news in the success colour — and one word
 * under it; each a way to where it is acted on. At the accessibility sizes
 * two to a row, so a word is never squeezed into a quarter of the screen.
 */
export function CounterTiles({ tiles, label }: { tiles: CounterTile[]; label: string }) {
  const { colors, lift } = useTheme();
  const large = useLargeText();
  return (
    <View accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
      {tiles.map((tile, index) => (
        <Appear key={tile.label} delay={index * motion.stagger} from="below" distance={8} style={{ flexGrow: 1, flexBasis: large ? '45%' : 0 }}>
          <PressableScale
            accessibilityRole="link"
            accessibilityLabel={`${tile.label}: ${tile.value}`}
            onPress={tile.onPress}
            style={({ pressed }) => ({
              alignItems: 'center',
              gap: space[0.5],
              paddingVertical: space[3],
              paddingHorizontal: space[1],
              ...corner('xl'),
              backgroundColor: pressed ? colors.muted : colors.card,
              ...lift,
            })}
          >
            <Num value={tile.value} variant="title" weight="bold" tone={tile.good ? 'success' : 'primary'} style={{ textAlign: 'center' }} />
            <Text variant="label" tone="mutedForeground" style={{ textAlign: 'center' }}>
              {tile.short}
            </Text>
          </PressableScale>
        </Appear>
      ))}
    </View>
  );
}
