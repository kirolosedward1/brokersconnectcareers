import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { Banknote, HandCoins, Scale, Sparkles, Target } from '~/components/ui/lucide';
import type { JobRow, SalaryReferenceRow } from '@/lib/supabase/database.types';
import { formatEgp } from '@/lib/format';
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
 * as a spec sheet: the basic salary large (with what listings like it pay,
 * when the board has five of them to say so), then the commission and its
 * note beside where the clients come from, then the benefits.
 */
export function CompensationCard({ job, reference }: { job: Comp; reference: SalaryReferenceRow | null }) {
  const locale = useLocale();
  const t = useTranslations('compensation');
  const tLeads = useTranslations('leadsSource');
  const tBenefit = useTranslations('benefits');
  const { colors, shadow } = useTheme();
  // Commission beside leads source, unless the text is at the accessibility
  // sizes: a 150-point column broke their words there.
  const cell = useLargeText() ? '100%' : 150;
  const pay = useCompensationText();
  const salary = pay.salary(job, locale);
  const hairline = { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border };

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
      <View style={{ padding: space[5], gap: space[1] }}>
        <Text variant="label" weight="semibold" tone="mutedForeground" accessibilityRole="header">
          {t('title')}
        </Text>
        <Label icon={<Banknote size={14} color={colors.mutedForeground} />}>{t('basicSalary')}</Label>
        <Text variant="title">
          <Text variant="title" weight="semibold" tone={salary.perMonth ? 'foreground' : 'mutedForeground'}>
            {salary.amount}
          </Text>
          {salary.perMonth ? <Text variant="small" tone="mutedForeground">{` ${salary.perMonth}`}</Text> : null}
        </Text>
        {reference ? (
          <View style={{ flexDirection: 'row', gap: space[1], marginTop: space[1] }}>
            <Scale size={13} color={colors.mutedForeground} style={{ marginTop: 3 }} />
            <Text variant="caption" tone="mutedForeground" style={{ flex: 1 }}>
              {t.markup('reference', {
                low: formatEgp(reference.low, locale),
                high: formatEgp(reference.high, locale),
                count: reference.sample,
                ...markupTags,
              })}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', ...hairline }}>
        <View style={{ flexGrow: 1, flexBasis: cell, padding: space[5], gap: space[1] }}>
          <Label icon={<HandCoins size={14} color={colors.mutedForeground} />}>{t('commission')}</Label>
          <Text weight="semibold">{pay.commission(job, locale)}</Text>
          {job.commission_note_ar ? (
            <Text variant="small" tone="mutedForeground">
              {job.commission_note_ar}
            </Text>
          ) : null}
        </View>
        <View style={{ flexGrow: 1, flexBasis: cell, padding: space[5], gap: space[1] }}>
          <Label icon={<Target size={14} color={colors.mutedForeground} />}>{t('leadsSource')}</Label>
          <Text weight="semibold">{tLeads(job.leads_source)}</Text>
        </View>
      </View>

      <View style={{ padding: space[5], gap: space[2], ...hairline }}>
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
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] + 2 }}>
      {icon}
      <Text variant="caption" weight="medium" tone="mutedForeground">
        {children}
      </Text>
    </View>
  );
}
