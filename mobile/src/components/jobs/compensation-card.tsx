import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { Banknote, HandCoins, Scale, Sparkles, Target } from 'lucide-react-native';
import type { JobRow, SalaryReferenceRow } from '@/lib/supabase/database.types';
import { formatEgp } from '@/lib/format';
import { Badge } from '~/components/ui/badge';
import { Text } from '~/components/ui/text';
import { useCompensationText } from '~/features/jobs/compensation';
import { markupTags } from '~/i18n/rich';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';

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
 * What the role pays, above any prose — the website's CompensationCard: the
 * basic salary (with what listings like it pay, when the board has five of
 * them to say so), the commission and its note, where the clients come from,
 * and the benefits.
 */
export function CompensationCard({ job, reference }: { job: Comp; reference: SalaryReferenceRow | null }) {
  const locale = useLocale();
  const t = useTranslations('compensation');
  const tLeads = useTranslations('leadsSource');
  const tBenefit = useTranslations('benefits');
  const { colors } = useTheme();
  const pay = useCompensationText();
  const salary = pay.salary(job, locale);

  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.card }}>
      <Text
        variant="small"
        weight="semibold"
        accessibilityRole="header"
        style={{ paddingHorizontal: space[4], paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        {t('title')}
      </Text>

      <Cell icon={<Banknote size={14} color={colors.mutedForeground} />} label={t('basicSalary')}>
        <Text>
          <Text weight="semibold" tone={salary.perMonth ? 'foreground' : 'mutedForeground'}>
            {salary.amount}
          </Text>
          {salary.perMonth ? <Text tone="mutedForeground">{` ${salary.perMonth}`}</Text> : null}
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
      </Cell>

      <Cell icon={<HandCoins size={14} color={colors.mutedForeground} />} label={t('commission')}>
        <Text weight="semibold">{pay.commission(job, locale)}</Text>
        {job.commission_note_ar ? (
          <Text variant="small" tone="mutedForeground">
            {job.commission_note_ar}
          </Text>
        ) : null}
      </Cell>

      <Cell icon={<Target size={14} color={colors.mutedForeground} />} label={t('leadsSource')}>
        <Text weight="semibold">{tLeads(job.leads_source)}</Text>
      </Cell>

      <Cell icon={<Sparkles size={14} color={colors.mutedForeground} />} label={t('benefits')} last>
        {job.benefits.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1], marginTop: 2 }}>
            {job.benefits.map((benefit) => (
              <Badge key={benefit} variant="outline" label={tBenefit(benefit)} />
            ))}
          </View>
        ) : (
          <Text variant="small" tone="mutedForeground">
            {t('noBenefits')}
          </Text>
        )}
      </Cell>
    </View>
  );
}

function Cell({ icon, label, children, last = false }: { icon: ReactNode; label: string; children: ReactNode; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        padding: space[4],
        gap: space[1],
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
        {icon}
        <Text variant="caption" weight="medium" tone="mutedForeground">
          {label}
        </Text>
      </View>
      {children}
    </View>
  );
}
