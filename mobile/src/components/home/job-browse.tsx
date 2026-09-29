import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import type { BrowseCounts } from '@/lib/read-types';
import type { DistrictRow } from '@/lib/supabase/database.types';
import { formatList, formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import { ForwardChevron } from '~/components/ui/icons';
import { Text } from '~/components/ui/text';
import { markupTags } from '~/i18n/rich';
import { useTheme } from '~/theme/provider';
import { hitTarget, space } from '~/theme/tokens';

/** Enough to choose from in one look; the board holds the rest. */
const MAX_ROWS = 6;

type Row = { key: string; label: string; count: number; params: Record<string, string> };

/**
 * The ways into the board, with how much is behind each — the website's
 * JobBrowse: by district, by track, by kind of company, busiest first, as a
 * ruled index rather than tiles. Nothing is listed at zero, a group with
 * nothing behind it is not drawn, and on an empty board the whole module
 * steps aside.
 *
 * Each row opens the board with that one filter applied; the figure here and
 * the count there come from the same predicates, so they agree.
 */
export function JobBrowse({ counts, districts }: { counts: BrowseCounts | undefined; districts: DistrictRow[] | undefined }) {
  const locale = useLocale();
  const t = useTranslations('landingPage.browse');
  const tTrack = useTranslations('track');
  const tCompanyType = useTranslations('companyType');
  const { colors } = useTheme();

  if (!counts || counts.total === 0) return null;

  const byId = new Map((districts ?? []).map((district) => [district.id, district]));

  const groups: { key: string; title: string; rows: Row[] }[] = [
    {
      key: 'location',
      title: t('byDistrict'),
      rows: counts.districts
        .flatMap(({ districtId, count }) => {
          const district = byId.get(districtId);
          return district
            ? [{ key: district.slug, label: localized(locale, district.name_ar, district.name_en), count, params: { district: district.slug } }]
            : [];
        })
        .slice(0, MAX_ROWS),
    },
    {
      key: 'track',
      title: t('byTrack'),
      rows: counts.tracks.slice(0, MAX_ROWS).map(({ track, count }) => ({
        key: track,
        label: tTrack(track),
        count,
        params: { track },
      })),
    },
    {
      key: 'companyType',
      title: t('byCompanyType'),
      rows: (counts.companyTypes ?? []).map(({ type, count }) => ({
        key: type,
        label: tCompanyType(`${type}_jobs`),
        count,
        params: { ctype: type },
      })),
    },
  ].filter((group) => group.rows.length > 0);

  if (groups.length === 0) return null;

  return (
    <View style={{ gap: space[5] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
        <Text variant="title" weight="bold" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {t('title')}
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => router.navigate('/jobs')}
          hitSlop={8}
          style={{ minHeight: hitTarget, flexDirection: 'row', alignItems: 'center', gap: 2 }}
        >
          <Text variant="small" weight="medium" tone="primary">
            {t.markup('allJobs', { count: formatNumber(counts.total, locale), ...markupTags })}
          </Text>
          <ForwardChevron size={16} color={colors.primary} />
        </Pressable>
      </View>

      {groups.map((group) => (
        <View key={group.key}>
          <Text
            variant="caption"
            weight="semibold"
            tone="mutedForeground"
            accessibilityRole="header"
            style={{ paddingBottom: space[2], borderBottomWidth: 1, borderBottomColor: colors.foreground }}
          >
            {group.title}
          </Text>
          {group.rows.map((row) => (
            <Pressable
              key={row.key}
              accessibilityRole="link"
              accessibilityLabel={formatList([row.label, t('jobsCount', { count: row.count })], locale)}
              onPress={() => router.navigate({ pathname: '/jobs', params: row.params })}
              style={({ pressed }) => ({
                minHeight: hitTarget,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: space[3],
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                backgroundColor: pressed ? colors.muted : 'transparent',
              })}
            >
              <Text weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>
                {row.label}
              </Text>
              <Text variant="small" tone="mutedForeground">
                {formatNumber(row.count, locale)}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}
