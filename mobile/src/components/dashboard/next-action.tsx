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
  const palette = {
    urgent: { accent: colors.destructive, background: colors.destructiveMuted },
    attention: { accent: colors.warning, background: colors.warningMuted },
    good: { accent: colors.primary, background: colors.secondary },
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
