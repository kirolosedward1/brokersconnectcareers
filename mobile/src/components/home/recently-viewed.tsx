import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { formatList } from '@/lib/format';
import { localized } from '@/lib/locale';
import { CompanyLogo } from '~/components/companies/company-logo';
import { ForwardChevron } from '~/components/ui/icons';
import { History } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { recentJobs, useListOwner, type ViewedJob } from '~/features/jobs/recent';
import { useHiddenCompanies } from '~/features/moderation/hidden-companies';
import { useHiddenJobs } from '~/features/moderation/hidden-jobs';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, space } from '~/theme/tokens';

/** How many the row shows. */
const SHOWN = 3;

/**
 * "Recently viewed": the last listings this person opened on this phone
 * (features/jobs/recent.ts), each a tap from opening again, with a way to
 * clear them. Nothing until something has been opened, and never a listing
 * from a company they hid.
 */
export function RecentlyViewed() {
  const t = useTranslations('app.home');
  const { colors, shadow } = useTheme();
  const owner = useListOwner();
  const hidden = useHiddenCompanies();
  const hiddenJobs = useHiddenJobs();
  const jobs = recentJobs.useItems(owner).filter((job) => !hidden.has(job.company.id) && !hiddenJobs.has(job.id)).slice(0, SHOWN);
  if (!jobs.length) return null;

  return (
    <View style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 1 }}>
          <History size={16} color={colors.mutedForeground} />
          <Text weight="semibold" accessibilityRole="header">
            {t('recentlyViewed')}
          </Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => recentJobs.clear(owner)} hitSlop={8} style={{ minHeight: hitTarget, justifyContent: 'center' }}>
          <Text variant="small" weight="medium" tone="primary">
            {t('recentlyViewedClear')}
          </Text>
        </Pressable>
      </View>
      <View
        style={{
          ...corner('xl'),
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.border,
          boxShadow: shadow.card,
          backgroundColor: colors.card,
          overflow: 'hidden',
        }}
      >
        {jobs.map((job, index) => (
          <ViewedRow key={job.id} job={job} first={index === 0} />
        ))}
      </View>
    </View>
  );
}

function ViewedRow({ job, first }: { job: ViewedJob; first: boolean }) {
  const locale = useLocale();
  const { colors } = useTheme();
  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);
  const district = localized(locale, job.district.name_ar, job.district.name_en);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={formatList([title, company, district], locale)}
      onPress={() => router.push({ pathname: '/jobs/[slug]', params: { slug: job.slug } })}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth * 2,
        borderTopColor: colors.border,
        backgroundColor: pressed ? colors.muted : 'transparent',
      })}
    >
      <CompanyLogo name={company} logoUrl={job.company.logo_url} seed={job.company.slug} size="sm" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="medium" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="small" tone="mutedForeground" numberOfLines={1}>
          {`${company} · ${district}`}
        </Text>
      </View>
      <ForwardChevron size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}
