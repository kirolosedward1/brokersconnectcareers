import { useTranslations } from 'use-intl';
import type { JobRow } from '@/lib/supabase/database.types';
import { formatEgp, formatRate } from '@/lib/format';
import { markupTags } from '~/i18n/rich';

type Pay = Pick<JobRow, 'basic_salary_min' | 'basic_salary_max' | 'commission_type' | 'commission_value'>;

/**
 * What a listing pays, in the website's own words (compensation.tsx): a range,
 * "from", "up to", or "commission only"; and the commission when it is a stated
 * percentage. Numbers are isolated left to right inside the Arabic sentence,
 * so a range still reads low to high in the sentence's own direction.
 */
export function useCompensationText() {
  const t = useTranslations('compensation');
  const tCommission = useTranslations('commissionType');

  return {
    salary(job: Pay, locale: string): { amount: string; perMonth: string | null } {
      const { basic_salary_min: min, basic_salary_max: max } = job;
      if (min == null && max == null) return { amount: t('commissionOnly'), perMonth: null };

      const amount =
        min != null && max != null
          ? t.markup('salaryRange', { min: formatEgp(min, locale), max: formatEgp(max, locale), ...markupTags })
          : min != null
            ? t.markup('salaryFrom', { min: formatEgp(min, locale), ...markupTags })
            : t.markup('salaryUpTo', { max: formatEgp(max as number, locale), ...markupTags });

      return { amount, perMonth: t('perMonth') };
    },

    commission(job: Pay, locale: string): string {
      if (job.commission_type === 'percentage' && job.commission_value != null) {
        return t.markup('commissionPercent', { value: formatRate(job.commission_value, locale), ...markupTags });
      }
      return tCommission(job.commission_type);
    },
  };
}
