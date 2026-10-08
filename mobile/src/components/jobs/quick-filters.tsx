import { View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import type { JobFilters } from '@/lib/job-filters';
import { localized } from '@/lib/locale';
import { Chip } from '~/components/ui/chip';
import { useBrowseCounts } from '~/features/browse/queries';
import { toggled } from '~/features/jobs/filters';
import { useDistricts } from '~/features/taxonomy';
import { space } from '~/theme/tokens';

/** How many of the busiest areas get a chip of their own. */
const AREAS = 2;

/**
 * The filters people reach for most, one tap each, under the board's title:
 * a basic salary, the primary and resale tracks, and the areas with the most
 * live listings right now (the website's browse counts). Each is the same
 * filter the sheet sets, on or off, so its chip below and the sheet agree.
 *
 * Wrapped, not a sideways strip: a strip scrolled from the wrong end under the
 * app's right to left in Expo Go.
 */
export function QuickFilters({ filters, apply }: { filters: JobFilters; apply: (next: JobFilters) => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const counts = useBrowseCounts().data;
  const districts = useDistricts().data ?? [];

  const busiest = (counts?.districts ?? [])
    .slice()
    .sort((a, b) => b.count - a.count)
    .map((entry) => districts.find((district) => district.id === entry.districtId))
    .filter((district): district is NonNullable<typeof district> => Boolean(district))
    .slice(0, AREAS);

  const withSalary = filters.hasBasicSalary === true;

  return (
    <View accessibilityLabel={t('app.jobs.quickFilters')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
      <Chip
        label={t('filters.hasBasicSalaryYes')}
        selected={withSalary}
        onPress={() => apply({ ...filters, hasBasicSalary: withSalary ? null : true })}
      />
      {(['primary', 'resale'] as const).map((track) => (
        <Chip
          key={track}
          label={t(`track.${track}`)}
          selected={filters.tracks.includes(track)}
          onPress={() => apply({ ...filters, tracks: toggled(filters.tracks, track) })}
        />
      ))}
      {busiest.map((district) => (
        <Chip
          key={district.slug}
          label={localized(locale, district.name_ar, district.name_en)}
          selected={filters.districtSlugs.includes(district.slug)}
          onPress={() => apply({ ...filters, districtSlugs: toggled(filters.districtSlugs, district.slug) })}
        />
      ))}
    </View>
  );
}
