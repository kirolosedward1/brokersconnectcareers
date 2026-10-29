import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { Banknote, HandCoins, Scale, Sparkles, Target } from '~/components/ui/lucide';
import type { JobRow, SalaryReferenceRow } from '@/lib/supabase/database.types';
import { formatEgp } from '@/lib/format';
import { Num, TABULAR } from '~/components/ui/num';
import { Text } from '~/components/ui/text';
import { useCompensationText } from '~/features/jobs/compensation';
import { markupTags } from '~/i18n/rich';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';

type Comp = Pick<
  JobRow,
  | 'basic_salary_min'
  | 'basic_salary_max'
  | 'commission_type'
  | 'commission_value'
  | 'commission_note_ar'
  | 'leads_source'
  | 'benefits'
>;

/**
 * What the role pays, above any prose — the website's CompensationCard, set
 * as the design's three tiles (JobDetail): the basic salary, the commission
 * and who brings the clients, side by side (stacked at the accessibility
 * sizes); then what listings like it pay, when the board has five of them to
 * say so, the commission's note, and the benefits.
 *
 * The listing is the one place a commission is shown (v1.1), with its terms.
 */
export function CompensationCard({ job, reference }: { job: Comp; reference: SalaryReferenceRow | null }) {
  const locale = useLocale();
  const t = useTranslations('compensation');
  const tLeads = useTranslations('leadsSource');
  const tBenefit = useTranslations('benefits');
  const tMoney = useTranslations('app.money');
  const { colors, shadow } = useTheme();
  const large = useLargeText();
  const pay = useCompensationText();
  const salary = pay.salary(job);
  const percent = job.commission_type === 'percentage' && job.commission_value != null ? job.commission_value : null;
  const hairline = { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border };
  const tile = { flexGrow: 1, flexBasis: large ? '100%' : 0, gap: space[0.5], padding: space[4] } as const;
  const between = large ? hairline : { borderStartWidth: StyleSheet.hairlineWidth * 2, borderStartColor: colors.border };

  return (
    <View
      style={{
        ...corner('xl'),
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.border,
        backgroundColor: colors.card,
        boxShadow: shadow.card,
      }}
    >
      <Text variant="label" weight="semibold" tone="mutedForeground" accessibilityRole="header" style={{ paddingHorizontal: space[4], paddingTop: space[4] }}>
        {t('title')}
      </Text>
      <View style={{ flexDirection: large ? 'column' : 'row' }}>
        <View style={tile} accessible accessibilityLabel={`${t('basicSalary')}: ${salary.unit ? `${salary.figures} ${salary.unit}` : salary.figures}`}>
          <Label icon={<Banknote size={14} color={colors.mutedForeground} />}>{t('basicSalary')}</Label>
          {salary.unit ? (
            <>
              <Text variant="title" weight="bold" tone="primary" style={TABULAR}>
                {salary.figures}
              </Text>
              <Text variant="caption" tone="mutedForeground">
                {salary.unit}
              </Text>
            </>
          ) : (
            <Text weight="semibold" tone="mutedForeground">
              {salary.figures}
            </Text>
          )}
        </View>
        <View style={[tile, between]} accessible accessibilityLabel={`${t('commission')}: ${pay.commission(job, locale)}`}>
          <Label icon={<HandCoins size={14} color={colors.mutedForeground} />}>{t('commission')}</Label>
          {percent !== null ? (
            <Num value={percent} percent variant="title" weight="bold" tone="goldForeground" />
          ) : (
            <Text weight="semibold">{pay.commission(job, locale)}</Text>
          )}
        </View>
        <View style={[tile, between]} accessible accessibilityLabel={`${t('leadsSource')}: ${tLeads(job.leads_source)}`}>
          <Label icon={<Target size={14} color={colors.mutedForeground} />}>{t('leadsSource')}</Label>
          <Text variant="small" weight="semibold" tone="primary">
            {tLeads(job.leads_source)}
          </Text>
        </View>
      </View>

      {reference || job.commission_note_ar ? (
        <View style={{ padding: space[4], gap: space[2], ...hairline }}>
          {reference ? (
            <View style={{ flexDirection: 'row', gap: space[1] }}>
              <Scale size={13} color={colors.mutedForeground} style={{ marginTop: 3 }} />
              <Text variant="caption" tone="mutedForeground" style={{ flex: 1 }}>
                {tMoney.markup('reference', {
                  low: formatEgp(reference.low, locale),
                  high: formatEgp(reference.high, locale),
                  count: reference.sample,
                  ...markupTags,
                })}
              </Text>
            </View>
          ) : null}
          {job.commission_note_ar ? (
            <Text variant="small" tone="mutedForeground">
              {job.commission_note_ar}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={{ padding: space[4], gap: space[2], ...hairline }}>
        <Label icon={<Sparkles size={14} color={colors.mutedForeground} />}>{t('benefits')}</Label>
        {job.benefits.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {job.benefits.map((benefit) => (
              <View
                key={benefit}
                // A capsule on one line; rounded, not clipped, when a large size wraps it.
                style={{ paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.muted }}
              >
                <Text variant="small" weight="medium">
                  {tBenefit(benefit)}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text variant="small" tone="mutedForeground">
            {t('noBenefits')}
          </Text>
        )}
      </View>
    </View>
  );
}

function Label({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1.5] }}>
      {icon}
      <Text variant="caption" weight="medium" tone="mutedForeground">
        {children}
      </Text>
    </View>
  );
}
