import { Pressable, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { formatNumber } from '@/lib/format';
import { profileGaps } from '@/lib/profile-completeness';
import type { AgentProfileRow } from '@/lib/supabase/database.types';
import { Card } from '~/components/ui/card';
import { ForwardChevron } from '~/components/ui/icons';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, space } from '~/theme/tokens';

/**
 * What is missing from the profile, and why each one matters — the website's
 * ProfileGaps: the same tests and weights as profile_completeness(), from the
 * shared table, biggest gain first. Nothing once the profile is complete.
 */
export function ProfileGaps({
  agent,
  completeness,
  hasExperience,
  hasEducation,
  onFill,
}: {
  agent: AgentProfileRow;
  completeness: number | null;
  hasExperience: boolean;
  hasEducation: boolean;
  /** Down the screen to the form, rather than away from it. */
  onFill: () => void;
}) {
  const t = useTranslations('cv');
  const locale = useLocale();
  const { colors } = useTheme();

  const gaps = profileGaps({
    summary_ar: agent.summary_ar,
    headline_ar: agent.headline_ar,
    tracks: agent.tracks,
    district_ids: agent.district_ids,
    years_experience: agent.years_experience,
    units_closed: agent.units_closed,
    volume_egp: agent.volume_egp,
    hasExperience,
    hasEducation,
  })
    .filter((gap) => gap.missing)
    .sort((a, b) => b.points - a.points);

  if (gaps.length === 0) return null;

  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: space[2] }}>
        <Text weight="semibold" accessibilityRole="header">
          {t('gapsTitle')}
        </Text>
        {completeness !== null ? (
          <Text variant="small" tone="mutedForeground">
            {t('gapsProgress', { percent: formatNumber(completeness, locale) })}
          </Text>
        ) : null}
      </View>

      {gaps.map((gap, index) => (
        <View
          key={gap.key}
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: space[3],
            paddingTop: index ? space[3] : 0,
            borderTopWidth: index ? 1 : 0,
            borderTopColor: colors.border,
          }}
        >
          <View style={{ paddingHorizontal: space[2], paddingVertical: 2, ...corner('md'), backgroundColor: colors.secondary }}>
            <Text variant="caption" weight="semibold" tone="primary">
              {t('gapsPoints', { points: formatNumber(gap.points, locale) })}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight="medium">{t(`gap_${gap.key}` as 'gap_summary')}</Text>
            <Text variant="small" tone="mutedForeground">
              {t(`gapWhy_${gap.key}` as 'gapWhy_summary')}
            </Text>
          </View>
        </View>
      ))}

      <Pressable
        accessibilityRole="button"
        onPress={onFill}
        style={{ minHeight: hitTarget, flexDirection: 'row', alignItems: 'center', gap: space[1] }}
      >
        <Text variant="small" weight="medium" tone="primary">
          {t('gapsCta')}
        </Text>
        <ForwardChevron size={16} color={colors.primary} />
      </Pressable>
    </Card>
  );
}
