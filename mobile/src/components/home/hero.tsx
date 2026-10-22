import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';

/**
 * The first thing Home shows: a deep sapphire panel falling to midnight, a
 * line in champagne above the headline, the headline and its promise, and
 * whatever the screen puts beneath (the search, its button); compact, a
 * dashboard's greeting in the same panel, with what stands beside it at its
 * end (`aside`: the reader's photo) — in Arabic, the left. Fine champagne
 * arcs open from its far corner, the way a plan's sightlines do; they are
 * drawing, not content, and are hidden from VoiceOver.
 */
export function Hero({
  eyebrow,
  title,
  subtitle,
  compact = false,
  aside,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** A dashboard's greeting: the same panel, a smaller headline. */
  compact?: boolean;
  /** Beside the words, at the end of the line, centred on them. */
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const { colors, shadow } = useTheme();
  const gap = compact ? space[1] : space[3];
  const words = (
    <>
      {eyebrow ? (
        <Text variant="label" weight="semibold" style={{ color: colors.champagne }}>
          {eyebrow}
        </Text>
      ) : null}
      <Text variant={compact ? 'title' : 'display'} weight="bold" accessibilityRole="header" style={{ color: colors.onHero }}>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="small" style={{ color: colors.onHeroMuted }}>
          {subtitle}
        </Text>
      ) : null}
    </>
  );

  return (
    <View style={{ ...corner('xxxl'), boxShadow: shadow.hero }}>
      <View
        style={{
          ...corner('xxxl'),
          overflow: 'hidden',
          backgroundColor: colors.hero,
          experimental_backgroundImage: `linear-gradient(160deg, ${colors.hero} 0%, ${colors.heroDeep} 100%)`,
          padding: compact ? space[5] : space[6],
          gap,
        }}
      >
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={{ position: 'absolute', top: -160, end: -160, width: 320, height: 320 }}
        >
          <Svg width={320} height={320}>
            {[70, 105, 140].map((r) => (
              <Circle key={r} cx={160} cy={160} r={r} stroke={colors.champagne} strokeOpacity={0.22} strokeWidth={1} fill="none" />
            ))}
          </Svg>
        </View>

        {aside ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[4] }}>
            <View style={{ flex: 1, gap }}>{words}</View>
            {aside}
          </View>
        ) : (
          words
        )}
        {children ? <View style={{ gap: space[3], marginTop: space[2] }}>{children}</View> : null}
      </View>
    </View>
  );
}
