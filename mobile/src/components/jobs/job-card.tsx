import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { VerifiedMark } from '~/components/companies/verified-mark';
import { BadgeCheck, CircleSlash, Sparkles, Star, Target } from '~/components/ui/lucide';
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
import { useJobMatch } from '~/features/jobs/match';
import { markupTags } from '~/i18n/rich';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * A listing in a list — the website's JobCard, the same facts set as a card
 * to be read in one look: who is hiring and where, then what it pays — the
 * salary first and largest, the commission and where the clients come from
 * beside it — and under a hairline the kind of role, the experience asked
 * for, the seats and how fresh it is. A candidate can bookmark it from here
 * without opening it (the website's card toggle).
 */
export function JobCard({ job, applied = false }: { job: JobListItem; applied?: boolean }) {
  const locale = useLocale();
  const t = useTranslations();
  const { colors } = useTheme();
  const pay = useCompensationText();
  const save = useSaveJob(job.id);
  // At the accessibility sizes nothing is cut short: the title and company in
  // full, and the footer's facts above the date rather than squeezed by it.
  const large = useLargeText();

  // How well it fits the candidate's own profile, when it fits at all (features/jobs/match.ts).
  const match = useJobMatch()(job);
  const closed = !jobIsLive(job);
  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);
  const district = localized(locale, job.district.name_ar, job.district.name_en);
  const salary = pay.salary(job, locale);
  const companyLeads = job.leads_source === 'company_provided';
  const leadsTone = companyLeads ? colors.primary : colors.mutedForeground;
  const flags = job.is_featured || closed || applied || match;
  const commission = job.commission_type === 'percentage' && job.commission_value != null ? pay.commission(job, locale) : null;
  const facts = [
    t(`track.${job.track}`),
    t(`experienceBand.${job.experience_band}`),
    `${formatNumber(job.seats, locale)} ${t('jobs.seatsLabel', { count: job.seats })}`,
  ].join(' · ');

  // One element to VoiceOver, so it says everything the card shows: who and
  // where, then what is true of it (featured, closed, applied to), what it
  // pays and the rest — a closed listing read as an open one was the cost.
  const spoken = [
    formatList([title, company, district], locale),
    job.company.verification_status === 'verified' ? t('companies.verified') : null,
    job.is_featured ? t('jobs.featured') : null,
    closed ? t('jobs.closedShort') : null,
    applied ? t('jobs.applied') : null,
    match ? t.markup('app.jobs.match', { percent: match.percent, ...markupTags }) : null,
    salary.perMonth ? `${salary.amount} ${salary.perMonth}` : salary.amount,
    commission,
    t(`leadsSource.${job.leads_source}_short`),
    facts,
    job.published_at ? formatRelativeDay(job.published_at, locale) : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Card
      onPress={() => router.push({ pathname: '/jobs/[slug]', params: { slug: job.slug } })}
      accessibilityLabel={spoken}
      accessibilityActions={save.savable ? [{ name: 'save', label: save.label }] : undefined}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'save') save.toggle();
      }}
    >
      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <CompanyLogo name={company} logoUrl={job.company.logo_url} seed={job.company.slug} size="sm" />

        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
            <Text
              variant="headline"
              weight="semibold"
              tone={closed ? 'mutedForeground' : 'foreground'}
              numberOfLines={large ? undefined : 2}
              style={{ flex: 1 }}
            >
              {title}
            </Text>
            {save.savable ? <SaveJobIcon save={save} /> : null}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space[1], rowGap: 2 }}>
            <Text variant="small" weight="medium" numberOfLines={large ? undefined : 1} style={{ flexShrink: 1 }}>
              {company}
            </Text>
            {job.company.verification_status === 'verified' ? (
              <VerifiedMark size={15} />
            ) : null}
            <Text variant="small" tone="mutedForeground">
              {` · ${district}`}
            </Text>
          </View>
        </View>
      </View>

      {flags ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1], marginTop: space[3] }}>
          {job.is_featured ? (
            <Badge variant="primary" label={t('jobs.featured')} icon={<Star size={11} color={colors.primary} />} />
          ) : null}
          {closed ? (
            <Badge label={t('jobs.closedShort')} icon={<CircleSlash size={11} color={colors.mutedForeground} />} />
          ) : null}
          {applied ? <Badge variant="success" label={t('jobs.applied')} /> : null}
          {match ? (
            <Badge
              variant="accent"
              label={t.markup('app.jobs.match', { percent: match.percent, ...markupTags })}
              icon={<Sparkles size={11} color={colors.accentForeground} />}
            />
          ) : null}
        </View>
      ) : null}

      <View style={{ marginTop: space[3], gap: 2 }}>
        <Text variant="body">
          <Text weight="semibold">{salary.amount}</Text>
          {salary.perMonth ? <Text variant="small" tone="mutedForeground">{` ${salary.perMonth}`}</Text> : null}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space[3], rowGap: 2 }}>
          {commission ? (
            <Text variant="small" weight="medium">
              {commission}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Target size={13} color={leadsTone} />
            <Text variant="small" weight={companyLeads ? 'medium' : 'regular'} style={{ color: leadsTone }}>
              {t(`leadsSource.${job.leads_source}_short`)}
            </Text>
          </View>
        </View>
      </View>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: space[3],
          rowGap: 2,
          marginTop: space[3],
          paddingTop: space[3],
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          borderTopColor: colors.border,
        }}
      >
        <Text variant="caption" tone="mutedForeground" style={{ flexGrow: 1, flexShrink: 1, flexBasis: 160 }}>
          {facts}
        </Text>
        {job.published_at ? (
          <Text variant="caption" tone="mutedForeground">
            {formatRelativeDay(job.published_at, locale)}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
