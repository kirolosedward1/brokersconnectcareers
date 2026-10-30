import { View } from 'react-native';
import {
  AlertTriangle,
  Clock,
  FileText,
  Inbox,
  RotateCcw,
  UserRound,
  type LucideIcon,
} from '~/components/ui/lucide';
import type { NextActionKind } from '@/lib/next-action';
import { ForwardChevron } from '~/components/ui/icons';
import { PressableScale } from '~/components/ui/pressable-scale';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, space } from '~/theme/tokens';

const ICONS = {
  applicants: Inbox,
  expiring: Clock,
  ended: RotateCcw,
  draft: FileText,
  verification: AlertTriangle,
  profile: UserRound,
  replies: Inbox,
} as const satisfies Record<NextActionKind, LucideIcon>;

export type NextActionTone = 'urgent' | 'attention' | 'good';

/**
 * The one thing worth doing right now — the website's NextAction: one card
 * above everything, chosen by an ordered list of conditions (first true wins),
 * so the screen says the same thing twice for the same state. The whole card
 * is the way there; nothing is drawn when nothing needs doing.
 */
export function NextAction({
  kind,
  tone,
  title,
  body,
  cta,
  onPress,
}: {
  kind: NextActionKind;
  tone: NextActionTone;
  title: string;
  body: string;
  cta: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const Icon = ICONS[kind];

  // Good news, as the design draws it (Main): the hero's navy, its words in
  // the light, and the way there as a champagne capsule. What needs fixing
  // keeps its own tint: the colour says how much it matters, the words what.
  if (tone === 'good') {
    return (
      <PressableScale
        accessibilityRole="link"
        accessibilityLabel={`${title}. ${body}`}
        accessibilityHint={cta}
        onPress={onPress}
        scaleTo={0.985}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[3],
          padding: space[4],
          ...corner('xl'),
          backgroundColor: colors.hero,
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <View style={{ width: 40, height: 40, ...corner('lg'), alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.1)' }}>
          <Icon size={20} color={colors.onHero} />
        </View>
        <View style={{ flex: 1, gap: space[0.5] }}>
          <Text weight="semibold" style={{ color: colors.onHero }}>
            {title}
          </Text>
          <Text variant="caption" style={{ color: colors.onHeroMuted }}>
            {body}
          </Text>
        </View>
        <View style={{ minHeight: 34, paddingHorizontal: space[3.5], justifyContent: 'center', ...corner('full'), backgroundColor: colors.champagne }}>
          <Text variant="small" weight="semibold" style={{ color: colors.champagneForeground }}>
            {cta}
          </Text>
        </View>
      </PressableScale>
    );
  }

  const palette = {
    urgent: { accent: colors.destructive, background: colors.destructiveMuted },
    attention: { accent: colors.warning, background: colors.warningMuted },
  }[tone];

  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityLabel={`${title}. ${body}`}
      accessibilityHint={cta}
      onPress={onPress}
      scaleTo={0.985}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[3],
        padding: space[4],
        ...corner('xl'),
        backgroundColor: palette.background,
        opacity: pressed ? 0.88 : 1,
      })}
    >
      <View
        style={{ width: 36, height: 36, ...corner('md'), alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card }}
      >
        <Icon size={18} color={palette.accent} />
      </View>
      <View style={{ flex: 1, gap: space[1] }}>
        <Text weight="semibold">{title}</Text>
        <Text variant="small" tone="mutedForeground">
          {body}
        </Text>
        <View style={{ minHeight: hitTarget - space[4], flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
          <Text variant="small" weight="semibold" style={{ color: palette.accent }}>
            {cta}
          </Text>
          <ForwardChevron size={16} color={palette.accent} />
        </View>
      </View>
    </PressableScale>
  );
}
