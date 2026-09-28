import { View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { BadgeCheck, CircleSlash, MapPin, Star, Target } from 'lucide-react-native';
import type { JobListItem } from '@/lib/job-list';
import { formatList, formatNumber, formatRelativeDay } from '@/lib/format';
import { jobIsLive } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import { Badge } from '~/components/ui/badge';
import { Card } from '~/components/ui/card';
import { Text } from '~/components/ui/text';
import { CompanyLogo } from '~/components/companies/company-logo';
import { SaveJobIcon, useSaveJob } from '~/components/saved/save-controls';
import { useCompensationText } from '~/features/jobs/compensation';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * A listing in a list — the website's JobCard, fact for fact and in the same
 * order: who and where, the track and the experience asked for; then what it
 * pays, the commission when it is a number, where the clients come from, and
 * how many seats. Freshness at the end of the first line. A candidate can
 * bookmark it from here without opening it (the website's card toggle).
 */
export function JobCard({ job, applied = false }: { job: JobListItem; applied?: boolean }) {
  const locale = useLocale();
  const t = useTranslations();
  const { colors } = useTheme();
  const pay = useCompensationText();
  const save = useSaveJob(job.id);

  const closed = !jobIsLive(job);
  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);
  const district = localized(locale, job.district.name_ar, job.district.name_en);
  const salary = pay.salary(job, locale);
  const leadsTone = job.leads_source === 'company_provided' ? colors.primary : colors.mutedForeground;

  return (
    <Card
      onPress={() => router.push({ pathname: '/jobs/[slug]', params: { slug: job.slug } })}
      accessibilityLabel={formatList([title, company, district], locale)}
      accessibilityActions={save.savable ? [{ name: 'save', label: save.label }] : undefined}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'save') save.toggle();
      }}
      style={closed ? { opacity: 0.7 } : undefined}
    >
      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <CompanyLogo name={company} logoUrl={job.company.logo_url} seed={job.company.slug} size="sm" />

        <View style={{ flex: 1, gap: space[1] }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
            <Text weight="semibold" style={{ flex: 1 }}>
              {title}
            </Text>
            {job.published_at ? (
              <Text variant="caption" tone="mutedForeground">
                {formatRelativeDay(job.published_at, locale)}
              </Text>
            ) : null}
            {save.savable ? <SaveJobIcon save={save} /> : null}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
            {job.is_featured ? (
              <Badge variant="accent" label={t('jobs.featured')} icon={<Star size={12} color={colors.accentForeground} />} />
            ) : null}
            {closed ? (
              <Badge label={t('jobs.closedShort')} icon={<CircleSlash size={12} color={colors.mutedForeground} />} />
            ) : null}
            {applied ? <Badge variant="success" label={t('jobs.applied')} /> : null}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space[3], rowGap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text variant="small" weight="medium">
                {company}
              </Text>
              {job.company.verification_status === 'verified' ? (
                <BadgeCheck size={14} color={colors.primary} accessibilityLabel={t('companies.verified')} />
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MapPin size={13} color={colors.mutedForeground} />
              <Text variant="small" tone="mutedForeground">
                {district}
              </Text>
            </View>
            <Text variant="small" tone="mutedForeground">
              {t(`track.${job.track}`)}
            </Text>
            <Text variant="small" tone="mutedForeground">
              {t(`experienceBand.${job.experience_band}`)}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space[3], rowGap: 2 }}>
            <Text variant="small">
              <Text variant="small" weight="semibold">
                {salary.amount}
              </Text>
              {salary.perMonth ? <Text variant="small" tone="mutedForeground">{` ${salary.perMonth}`}</Text> : null}
            </Text>
            {job.commission_type === 'percentage' && job.commission_value != null ? (
              <Text variant="small" tone="mutedForeground">
                {pay.commission(job, locale)}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Target size={13} color={leadsTone} />
              <Text variant="small" style={{ color: leadsTone }}>
                {t(`leadsSource.${job.leads_source}_short`)}
              </Text>
            </View>
            <Text variant="small" tone="mutedForeground">
              <Text variant="small" weight="medium">
                {formatNumber(job.seats, locale)}
              </Text>
              {` ${t('jobs.seatsLabel', { count: job.seats })}`}
            </Text>
          </View>
        </View>
      </View>
    </Card>
  );
}
