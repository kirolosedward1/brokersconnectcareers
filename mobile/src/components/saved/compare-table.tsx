import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import type { JobListItem } from '@/lib/job-list';
import { formatDate, formatNumber, formatRelativeDay } from '@/lib/format';
import { localized } from '@/lib/locale';
import { CompanyLogo } from '~/components/companies/company-logo';
import { VerifiedMark } from '~/components/companies/verified-mark';
import { Appear } from '~/components/motion/appear';
import { ForwardChevron } from '~/components/ui/icons';
import { MoveHorizontal, TrendingUp } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { useCompensationText } from '~/features/jobs/compensation';
import { bestOf } from '~/features/saved/compare';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, motion, space } from '~/theme/tokens';

/** A column is never narrower than this: a salary range and a district on two short lines. */
const LEAST_COLUMN = 136;
/** At the accessibility text sizes, wider, and the table scrolls sideways sooner. */
const LEAST_COLUMN_LARGE = 208;
const GAP = space[2];

type Row = {
  key: string;
  label: string;
  /** What the cell says, and a second, quieter line under it. */
  value: (job: JobListItem) => { main: string; sub?: string | null };
  /** The columns best in this row, marked; none where no column is better. */
  best?: ReadonlySet<string>;
};

/**
 * Two or three saved listings side by side, a column each in the order they
 * were chosen: who is hiring at the head of each, then a row per fact — where,
 * the basic salary a month, the commission, who brings the clients, the kind
 * of role, the experience asked, the open seats and how fresh — and a link to
 * each listing at the foot.
 *
 * Where one column is better than the others — the highest salary or
 * commission, the company bringing the clients, the most seats — its cell is
 * tinted and says "best", in words as well as colour. Nothing is marked where
 * they are all the same.
 *
 * The columns share the width; on a small phone, or with large text, they
 * keep a readable width and the table scrolls sideways, starting from the
 * reading side (React Native lays a horizontal scroll right to left with the
 * app's direction).
 */
export function CompareTable({ jobs }: { jobs: JobListItem[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const pay = useCompensationText();
  const { width } = useWindowDimensions();
  const large = useLargeText();
  const best = bestOf(jobs);

  const room = width - gutter * 2;
  const least = large ? LEAST_COLUMN_LARGE : LEAST_COLUMN;
  const column = Math.max(least, Math.floor((room - GAP * (jobs.length - 1)) / jobs.length));
  const span = column * jobs.length + GAP * (jobs.length - 1);
  const scrolls = span > room + 1;

  const rows: Row[] = [
    { key: 'district', label: t('filters.district'), value: (job) => ({ main: localized(locale, job.district.name_ar, job.district.name_en) }) },
    {
      key: 'salary',
      label: t('app.saved.compare.salary'),
      value: (job) => ({ main: pay.salary(job, locale).amount }),
      best: best.salary,
    },
    { key: 'commission', label: t('compensation.commission'), value: (job) => ({ main: pay.commission(job, locale) }), best: best.commission },
    { key: 'leads', label: t('compensation.leadsSource'), value: (job) => ({ main: t(`leadsSource.${job.leads_source}`) }), best: best.leads },
    { key: 'track', label: t('filters.track'), value: (job) => ({ main: t(`track.${job.track}`) }) },
    { key: 'experience', label: t('jobForm.experienceBand'), value: (job) => ({ main: t(`experienceBand.${job.experience_band}`) }) },
    {
      key: 'seats',
      label: t('jobForm.seats'),
      value: (job) => ({ main: `${formatNumber(job.seats, locale)} ${t('jobs.seatsLabel', { count: job.seats })}` }),
      best: best.seats,
    },
    {
      key: 'fresh',
      label: t('filters.posted'),
      value: (job) => ({
        main: job.published_at ? formatRelativeDay(job.published_at, locale) : '—',
        sub: job.expires_at ? t('jobs.expiresOn', { date: formatDate(job.expires_at, locale) }) : null,
      }),
    },
  ];

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingTop: space[4], paddingBottom: space[10], gap: space[4] }}
    >
      <View style={{ paddingHorizontal: gutter, gap: space[1] }}>
        <Text variant="small" tone="mutedForeground">
          {t('app.saved.compare.lede')}
        </Text>
        {scrolls ? <ScrollHint /> : null}
      </View>

      <ScrollView
        horizontal
        scrollEnabled={scrolls}
        showsHorizontalScrollIndicator={scrolls}
        contentContainerStyle={{ paddingHorizontal: gutter }}
      >
        <View style={{ width: span, gap: space[5] }}>
          <Appear>
            <View style={{ flexDirection: 'row', gap: GAP }}>
              {jobs.map((job) => (
                <Head key={job.id} job={job} width={column} />
              ))}
            </View>
          </Appear>

          {rows.map((row, index) => (
            <Appear key={row.key} delay={Math.min(index + 1, 6) * (motion.stagger / 2)}>
              <View style={{ gap: space[2] }}>
                <Text variant="caption" weight="semibold" tone="mutedForeground" accessibilityRole="header">
                  {row.label}
                </Text>
                <View style={{ flexDirection: 'row', gap: GAP }}>
                  {jobs.map((job) => (
                    <Cell key={job.id} job={job} width={column} {...row.value(job)} best={row.best?.has(job.id) ?? false} />
                  ))}
                </View>
              </View>
            </Appear>
          ))}

          <View style={{ flexDirection: 'row', gap: GAP }}>
            {jobs.map((job) => (
              <OpenLink key={job.id} job={job} width={column} />
            ))}
          </View>
        </View>
      </ScrollView>
    </ScrollView>
  );
}

/** Who is hiring, at the head of a column: the mark, the title, the company with its verified tick. */
function Head({ job, width }: { job: JobListItem; width: number }) {
  const large = useLargeText();
  const locale = useLocale();
  const { colors, lift } = useTheme();
  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);
  return (
    <View
      style={{
        width,
        gap: space[2],
        padding: space[3],
        ...corner('xl'),
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.border,
        backgroundColor: colors.card,
        ...lift,
      }}
    >
      <CompanyLogo name={company} logoUrl={job.company.logo_url} seed={job.company.slug} size="sm" />
      <Text variant="small" weight="semibold" accessibilityRole="header" numberOfLines={large ? undefined : 3}>
        {title}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space[1] }}>
        <Text variant="caption" tone="mutedForeground" numberOfLines={large ? undefined : 2} style={{ flexShrink: 1 }}>
          {company}
        </Text>
        {job.company.verification_status === 'verified' ? <VerifiedMark size={14} /> : null}
      </View>
    </View>
  );
}

/** One fact of one listing; tinted, and saying so, where it is the best of the row. */
function Cell({ job, width, main, sub, best }: { job: JobListItem; width: number; main: string; sub?: string | null; best: boolean }) {
  const t = useTranslations('app.saved.compare');
  const locale = useLocale();
  const { colors } = useTheme();
  const title = localized(locale, job.title_ar, job.title_en);
  return (
    <View
      accessible
      accessibilityLabel={[title, main, sub, best ? t('best') : null].filter(Boolean).join('. ')}
      style={{
        width,
        gap: 2,
        paddingHorizontal: space[3],
        paddingVertical: space[2.5],
        ...corner('lg'),
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: best ? 'transparent' : colors.border,
        backgroundColor: best ? colors.successMuted : colors.card,
      }}
    >
      {best ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <TrendingUp size={12} color={colors.success} />
          <Text variant="label" weight="semibold" tone="success">
            {t('best')}
          </Text>
        </View>
      ) : null}
      <Text variant="small" weight={best ? 'semibold' : 'medium'}>
        {main}
      </Text>
      {sub ? (
        <Text variant="caption" tone="mutedForeground">
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/** The way to the listing itself, at the foot of its column. */
function OpenLink({ job, width }: { job: JobListItem; width: number }) {
  const large = useLargeText();
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const title = localized(locale, job.title_ar, job.title_en);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[t('app.jobMenu.open'), title].join('. ')}
      onPress={() => router.push({ pathname: '/jobs/[slug]', params: { slug: job.slug } })}
      style={({ pressed }) => ({
        width,
        minHeight: hitTarget,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[1],
        paddingHorizontal: space[3],
        ...corner('full'),
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.muted : colors.card,
      })}
    >
      <Text variant="small" weight="semibold" tone="primary" numberOfLines={large ? undefined : 1} style={{ flexShrink: 1 }}>
        {t('app.jobMenu.open')}
      </Text>
      <ForwardChevron size={16} color={colors.primary} />
    </Pressable>
  );
}

/** Said once, above a table wider than the phone. */
function ScrollHint() {
  const t = useTranslations('app.saved.compare');
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
      <MoveHorizontal size={14} color={colors.mutedForeground} />
      <Text variant="caption" tone="mutedForeground">
        {t('scrollHint')}
      </Text>
    </View>
  );
}
