import { useState, type ComponentType } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { formatNumber } from '@/lib/format';
import { EMPTY_FILTERS, type JobFilters } from '@/lib/job-filters';
import { Appear } from '~/components/motion/appear';
import { useCountUp } from '~/components/motion/rolling-number';
import { ForwardChevron } from '~/components/ui/icons';
import { Briefcase, Eye, MailCheck, type LucideProps } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { boardQuery, filtersToParams } from '~/features/jobs/filters';
import { useBoardTotal } from '~/features/jobs/queries';
import { useDistricts } from '~/features/taxonomy';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, motion, space } from '~/theme/tokens';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The candidate's week in three figures, counting up as the card comes in:
 * new listings in their areas (or on the whole board while the profile names
 * none), the applications a company opened, and who looked at their profile
 * (the website counts that over thirty days, and the line says so). Each is a
 * way to where it is: the board narrowed to those listings, the applications,
 * the profile.
 */
export function WeeklySummary({
  districtIds,
  applications,
  profileViews,
}: {
  districtIds: number[];
  applications: { employer_viewed_at: string | null }[];
  profileViews: number;
}) {
  const t = useTranslations('app.week');
  const { colors, shadow } = useTheme();
  const districts = useDistricts().data ?? [];
  // When the week is counted back from: the moment Home was drawn.
  const [now] = useState(() => Date.now());

  const slugs = districts.filter((district) => districtIds.includes(district.id)).map((district) => district.slug);
  const filters: JobFilters = { ...EMPTY_FILTERS, districtSlugs: slugs, postedWithin: 7 };
  const fresh = useBoardTotal(boardQuery(filters), true).data;
  const opened = applications.filter((application) => {
    const at = application.employer_viewed_at ? Date.parse(application.employer_viewed_at) : NaN;
    return Number.isFinite(at) && now - at <= WEEK_MS;
  }).length;

  return (
    <Appear delay={motion.stagger}>
      <View
        style={{
          gap: space[1],
          paddingVertical: space[3],
          paddingHorizontal: space[4],
          ...corner('xl'),
          backgroundColor: colors.card,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.border,
          boxShadow: shadow.card,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: space[1] }}>
          <Text weight="semibold" accessibilityRole="header">
            {t('title')}
          </Text>
          <Text variant="caption" tone="mutedForeground">
            {t('lede')}
          </Text>
        </View>
        <Line
          icon={Briefcase}
          count={fresh ?? null}
          label={slugs.length ? t('newJobsAreas') : t('newJobs')}
          onPress={() => router.navigate({ pathname: '/jobs', params: filtersToParams(filters) })}
        />
        <Line icon={MailCheck} count={opened} label={t('opened')} onPress={() => router.navigate('/dashboard/applications')} />
        <Line icon={Eye} count={profileViews} label={t('views')} onPress={() => router.navigate('/account/profile')} />
      </View>
    </Appear>
  );
}

function Line({
  icon: Icon,
  count,
  label,
  onPress,
}: {
  icon: ComponentType<LucideProps>;
  /** Null while it is still being counted on the server. */
  count: number | null;
  label: string;
  onPress: () => void;
}) {
  const locale = useLocale();
  const { colors } = useTheme();
  const rolled = useCountUp(count ?? 0);
  const figure = count === null ? '—' : formatNumber(rolled, locale);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${count === null ? '' : formatNumber(count, locale)} ${label}`.trim()}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        marginHorizontal: -space[2],
        paddingHorizontal: space[2],
        ...corner('lg'),
        backgroundColor: pressed ? colors.muted : 'transparent',
      })}
    >
      <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', ...corner('full'), backgroundColor: colors.secondary }}>
        <Icon size={16} color={colors.primary} />
      </View>
      <Text variant="headline" weight="bold" style={{ minWidth: 36, fontVariant: ['tabular-nums'] }}>
        {figure}
      </Text>
      <Text variant="small" tone="mutedForeground" style={{ flex: 1 }} numberOfLines={2}>
        {label}
      </Text>
      <ForwardChevron size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}
