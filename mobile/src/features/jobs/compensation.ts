import { useTranslations } from 'use-intl';
import type { JobRow } from '@/lib/supabase/database.types';
import { formatRate } from '@/lib/format';
import { useMoney } from '~/features/money';
import { markupTags } from '~/i18n/rich';

type Pay = Pick<JobRow, 'basic_salary_min' | 'basic_salary_max' | 'commission_type' | 'commission_value'>;

export type SalaryText = {
  /**
   * The basic salary's figures, without the currency — "12,000 – 18,000",
   * "من 12,000" — or the website's words when there is none: "commission
   * only", "no basic salary".
   */
  figures: string;
  /** «ج.م / شهر» beside the figures; null when there are no figures. */
  unit: string | null;
  /** The whole of it in one line, with its currency: "12,000 – 18,000 ج.م", or the words. */
  amount: string;
};

/**
 * What a listing pays, as the website says it (compensation.tsx): a range,
 * "from", "up to", or "commission only"; and the commission when it is a
 * stated percentage. Amounts carry their currency (features/money.ts); a
 * range is one left-to-right run, low to high.
 *
 * The commission is said only where the listing's terms are: the listing
 * itself, the wizard, editing it, and the admin's review.
 */
export function useCompensationText() {
  const t = useTranslations('compensation');
  const tCommission = useTranslations('commissionType');
  const money = useMoney();

  return {
    salary(job: Pay): SalaryText {
      const { basic_salary_min: min, basic_salary_max: max } = job;
      const figures = money.figures(min, max);
      const amount = money.pay(min, max);
      // As the website's: "commission only", unless the listing also says
      // there is no commission.
      if (figures === null || amount === null) {
        const words = t(job.commission_type === 'none' ? 'noBasicSalary' : 'commissionOnly');
        return { figures: words, unit: null, amount: words };
      }
      return { figures, unit: money.perMonth, amount };
    },

    commission(job: Pay, locale: string): string {
      if (job.commission_type === 'percentage' && job.commission_value != null) {
        return t.markup('commissionPercent', { value: formatRate(job.commission_value, locale), ...markupTags });
      }
      return tCommission(job.commission_type);
    },
  };
}
