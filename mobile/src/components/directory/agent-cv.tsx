import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { Award, Briefcase, GraduationCap, Quote } from '~/components/ui/lucide';
import { formatEgp, formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import type { DistrictRow } from '@/lib/supabase/database.types';
import { Card } from '~/components/ui/card';
import { Text } from '~/components/ui/text';
import type { CvSections } from '~/features/profile/queries';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';

/**
 * The CV half of a consultant's page — the website's AgentCv. Nothing here
 * decides who may see it: every row was read under the reader's own session,
 * and row-level security already dropped what this company may not see
 * (including, for a consultant hiding from their employer, the row naming
 * that employer). An empty section is not drawn at all.
 */
export function AgentCv({
  summary,
  unitsClosed,
  volumeEgp,
  sections,
  districts,
}: {
  summary: string | null;
  unitsClosed: number | null;
  volumeEgp: number | null;
  sections: CvSections;
  districts: Map<number, DistrictRow>;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const { experience, education, certifications } = sections;

  const hasRecord = unitsClosed != null || volumeEgp != null;
  if (!summary && !hasRecord && !experience.length && !education.length && !certifications.length) return null;

  const month = (value: string) => value.slice(0, 7);

  return (
    <View style={{ gap: space[8] }}>
      {summary ? (
        <Section title={t('cv.objective')} icon={<Quote size={16} color={colors.mutedForeground} />}>
          {/* Their own words, as a quote: set on a soft card, a gold rule at the start. */}
          <View
            style={{
              flexDirection: 'row',
              gap: space[3],
              padding: space[4],
              ...corner('xl'),
              backgroundColor: colors.card,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: colors.border,
            }}
          >
            <View style={{ width: 3, borderRadius: 2, backgroundColor: colors.gold }} />
            <Text style={{ flex: 1, lineHeight: 28 }}>{summary}</Text>
          </View>
        </Section>
      ) : null}

      {/* The record leads: in this market it is what an employer reads first. Self-reported, and said so. */}
      {hasRecord ? (
        <Section title={t('cv.record')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
            {unitsClosed != null ? (
              <Card style={{ flexGrow: 1, flexBasis: 140, gap: space[1] }}>
                <Text variant="caption" tone="mutedForeground">
                  {t('cv.unitsClosed')}
                </Text>
                <Text variant="title" weight="bold">
                  {formatNumber(unitsClosed, locale)}
                </Text>
              </Card>
            ) : null}
            {volumeEgp != null ? (
              <Card style={{ flexGrow: 1, flexBasis: 140, gap: space[1] }}>
                <Text variant="caption" tone="mutedForeground">
                  {t('cv.volumeEgp')}
                </Text>
                <Text variant="title" weight="bold">
                  {formatEgp(volumeEgp, locale)}
                </Text>
              </Card>
            ) : null}
          </View>
          <Text variant="caption" tone="mutedForeground">
            {t('cv.recordHint')}
          </Text>
        </Section>
      ) : null}

      {experience.length ? (
        <Section title={t('cv.experience')} icon={<Briefcase size={16} color={colors.mutedForeground} />}>
          <View>
            {experience.map((job, index) => {
              const district = job.district_id ? districts.get(job.district_id) : null;
              const last = index === experience.length - 1;
              return (
                <View key={job.id} style={{ flexDirection: 'row', gap: space[3] }}>
                  {/* The timeline: a filled mark for the role still held. */}
                  <View style={{ alignItems: 'center', width: 10 }}>
                    <View
                      style={{
                        marginTop: 8,
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: job.ended ? colors.border : colors.primary,
                      }}
                    />
                    {last ? null : <View style={{ flex: 1, width: 1, backgroundColor: colors.border }} />}
                  </View>
                  <View style={{ flex: 1, gap: 2, paddingBottom: last ? 0 : space[5] }}>
                    <Text weight="semibold">{job.title}</Text>
                    <Text variant="small" tone="mutedForeground">
                      {`${job.company_name}${district ? ` · ${localized(locale, district.name_ar, district.name_en)}` : ''}`}
                    </Text>
                    <Text variant="caption" tone="mutedForeground">
                      {`${month(job.started)} — ${job.ended ? month(job.ended) : t('cv.present')}${
                        job.track ? ` · ${t(`track.${job.track}`)}` : ''
                      }`}
                    </Text>
                    {job.highlights ? (
                      <Text variant="small" tone="mutedForeground" style={{ marginTop: space[1] }}>
                        {job.highlights}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        </Section>
      ) : null}

      {education.length ? (
        <Section title={t('cv.education')} icon={<GraduationCap size={16} color={colors.mutedForeground} />}>
          <View style={{ gap: space[3] }}>
            {education.map((row) => (
              <View key={row.id} style={{ gap: 2 }}>
                <Text weight="medium">{row.institution}</Text>
                {row.degree || row.field || row.graduated ? (
                  <Text variant="small" tone="mutedForeground">
                    {[row.degree, row.field, row.graduated ? String(row.graduated) : null].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {certifications.length ? (
        <Section title={t('cv.certifications')} icon={<Award size={16} color={colors.mutedForeground} />}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {certifications.map((row) => (
              <Card key={row.id} style={{ paddingVertical: space[2], paddingHorizontal: space[3] }}>
                <Text variant="small">
                  <Text variant="small" weight="medium">
                    {row.name}
                  </Text>
                  {row.issuer ? <Text variant="small" tone="mutedForeground">{` · ${row.issuer}`}</Text> : null}
                </Text>
              </Card>
            ))}
          </View>
        </Section>
      ) : null}
    </View>
  );
}

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        {icon}
        <Text variant="small" weight="semibold" accessibilityRole="header">
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}
