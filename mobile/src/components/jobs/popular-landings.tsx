import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import type { BrowseCounts } from '@/lib/read-types';
import type { DistrictRow } from '@/lib/supabase/database.types';
import { formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import { buildLandingSlug } from '@/lib/taxonomy';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * The track-in-district pages that have live listings, busiest first — the
 * website's PopularLandings, under the unfiltered board. Every row opens a
 * page with roles on it; a pair with nothing open is not offered.
 */
export function PopularLandings({
  counts,
  districts,
  limit = 12,
}: {
  counts: BrowseCounts | undefined;
  districts: DistrictRow[] | undefined;
  limit?: number;
}) {
  const locale = useLocale();
  const t = useTranslations('landing');
  const tTrack = useTranslations('track');
  const { colors } = useTheme();

  const byId = new Map((districts ?? []).map((district) => [district.id, district]));
  const pairs = (counts?.pairs ?? []).filter((pair) => byId.has(pair.districtId)).slice(0, limit);
  if (!pairs.length) return null;

  return (
    <View style={{ marginTop: space[8], paddingTop: space[5], borderTopWidth: 1, borderTopColor: colors.border }}>
      <Text variant="small" weight="semibold" accessibilityRole="header">
        {t('popularTitle')}
      </Text>
      <View style={{ marginTop: space[2] }}>
        {pairs.map((pair) => {
          const district = byId.get(pair.districtId) as DistrictRow;
          const title = t('title', {
            track: tTrack(pair.track),
            district: localized(locale, district.name_ar, district.name_en),
          });
          return (
            <Pressable
              key={`${pair.track}:${pair.districtId}`}
              accessibilityRole="link"
              onPress={() =>
                router.push({ pathname: '/jobs/[slug]', params: { slug: buildLandingSlug(pair.track, district.slug) } })
              }
              style={({ pressed }) => ({
                minHeight: 40,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[2],
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text variant="small" tone="mutedForeground" style={{ flexShrink: 1 }}>
                {title}
              </Text>
              <Text variant="caption" tone="mutedForeground">
                {formatNumber(pair.count, locale)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
