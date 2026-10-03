import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import type { BrowseCounts } from '@/lib/read-types';
import type { DistrictRow } from '@/lib/supabase/database.types';
import { formatList, formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import { ForwardChevron } from '~/components/ui/icons';
import { SectionHeader } from '~/components/ui/section-header';
import { Text } from '~/components/ui/text';
import { markupTags } from '~/i18n/rich';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, space } from '~/theme/tokens';

/** Enough to choose from in one look; the board holds the rest. */
const MAX_ROWS = 6;

type Row = { key: string; label: string; count: number; params: Record<string, string> };

/**
 * The ways into the board, with how much is behind each — the website's
 * JobBrowse: by district, by track, by kind of company, busiest first, each
 * group a list on a card with its figure in a pill, rather than tiles.
 * Nothing is listed at zero, a group with
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
  const { colors, shadow } = useTheme();
  // A place's name in full at the accessibility sizes, on as many lines as it takes.
  const large = useLargeText();

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
      <SectionHeader
        title={t('title')}
        action={t.markup('allJobs', { count: formatNumber(counts.total, locale), ...markupTags })}
        onAction={() => router.navigate('/jobs')}
      />

      {groups.map((group) => (
        <View key={group.key} style={{ gap: space[2] }}>
          <Text variant="label" weight="semibold" tone="mutedForeground" accessibilityRole="header" style={{ paddingHorizontal: space[1] }}>
            {group.title}
          </Text>
          <View
            style={{
              ...corner('xl'),
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: colors.border,
              backgroundColor: colors.card,
              boxShadow: shadow.card,
              overflow: 'hidden',
            }}
          >
            {group.rows.map((row, index) => (
              <Pressable
                key={row.key}
                accessibilityRole="link"
                accessibilityLabel={formatList([row.label, t('jobsCount', { count: row.count })], locale)}
                onPress={() => router.navigate({ pathname: '/jobs', params: row.params })}
                style={({ pressed }) => ({
                  minHeight: hitTarget + 8,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space[3],
                  paddingHorizontal: space[4],
                  backgroundColor: pressed ? colors.muted : 'transparent',
                })}
              >
                <View
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space[3],
                    alignSelf: 'stretch',
                    paddingVertical: large ? space[2] : 0,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth * 2,
                    borderTopColor: colors.border,
                  }}
                >
                  <Text weight="medium" numberOfLines={large ? undefined : 1} style={{ flex: 1 }}>
                    {row.label}
                  </Text>
                  <View style={{ minWidth: 28, paddingHorizontal: space[2], paddingVertical: 2, ...corner('full'), backgroundColor: colors.secondary, alignItems: 'center' }}>
                    <Text variant="caption" weight="semibold" tone="secondaryForeground">
                      {formatNumber(row.count, locale)}
                    </Text>
                  </View>
                  <ForwardChevron size={16} color={colors.mutedForeground} />
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
