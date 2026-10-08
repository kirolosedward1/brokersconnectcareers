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
          {/* One card, a row per role: the role on its tile, where, when — the
              role still held marked "now" — and what they did, set apart. */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {experience.map((job, index) => {
              const district = job.district_id ? districts.get(job.district_id) : null;
              const current = !job.ended;
              return (
                <View
                  key={job.id}
                  style={{
                    flexDirection: 'row',
                    gap: space[3],
                    padding: space[4],
                    borderTopWidth: index ? StyleSheet.hairlineWidth * 2 : 0,
                    borderTopColor: colors.border,
                  }}
                >
                  <Tile>
                    <Briefcase size={18} color={current ? colors.primary : colors.mutedForeground} />
                  </Tile>
                  <View style={{ flex: 1, gap: space[1] }}>
                    <Text weight="semibold">{job.title}</Text>
                    <Text variant="small" tone="mutedForeground">
                      {[job.company_name, district ? localized(locale, district.name_ar, district.name_en) : null].filter(Boolean).join(' · ')}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2], marginTop: 2 }}>
                      <Text variant="caption" weight="medium" tone="mutedForeground">
                        {job.ended ? `${monthYear(job.started, locale)} — ${monthYear(job.ended, locale)}` : monthYear(job.started, locale)}
                      </Text>
                      {current ? <Tag label={t('app.cv.current')} tone="success" /> : null}
                      {job.track ? <Tag label={t(`track.${job.track}`)} /> : null}
                    </View>
                    {job.highlights ? (
                      <View style={{ marginTop: space[2], padding: space[3], ...corner('lg'), backgroundColor: colors.muted }}>
                        <Text variant="small">{job.highlights}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </Card>
        </Section>
      ) : null}

      {education.length ? (
        <Section title={t('cv.education')} icon={<GraduationCap size={16} color={colors.mutedForeground} />}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {education.map((row, index) => (
              <View
                key={row.id}
                style={{
                  flexDirection: 'row',
                  gap: space[3],
                  padding: space[4],
                  borderTopWidth: index ? StyleSheet.hairlineWidth * 2 : 0,
                  borderTopColor: colors.border,
                }}
              >
                <Tile>
                  <GraduationCap size={18} color={colors.primary} />
                </Tile>
                <View style={{ flex: 1, gap: space[1] }}>
                  <Text weight="semibold">{row.institution}</Text>
                  {row.degree || row.field ? (
                    <Text variant="small" tone="mutedForeground">
                      {[row.degree, row.field].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                  {row.graduated ? (
                    <View style={{ flexDirection: 'row', marginTop: 2 }}>
                      <Tag label={String(row.graduated)} />
                    </View>
                  ) : null}
                </View>
              </View>
            ))}
          </Card>
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

/** A month and its year, in the reader's language: "مارس 2024". */
function monthYear(value: string, locale: string): string {
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value.slice(0, 7);
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** A row's icon on its tile, as on the card's facts above. */
function Tile({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: 40, height: 40, ...corner('md'), alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondary }}>
      {children}
    </View>
  );
}

/** A small soft tag: a track, a year — "now" in green. */
function Tag({ label, tone }: { label: string; tone?: 'success' }) {
  const { colors } = useTheme();
  return (
    <View style={{ paddingVertical: 2, paddingHorizontal: space[2], ...corner('full'), backgroundColor: tone === 'success' ? colors.successMuted : colors.muted }}>
      <Text variant="caption" weight="semibold" style={{ color: tone === 'success' ? colors.success : colors.foreground }}>
        {label}
      </Text>
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
