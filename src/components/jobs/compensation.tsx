import { useTranslations } from 'next-intl';
import { Banknote, HandCoins, Sparkles, Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatEgp } from '@/lib/utils';
import type { JobRow } from '@/lib/supabase/database.types';

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

/** One-line salary summary, shared by the card and the detail card. */
export function SalaryLine({ job, locale }: { job: Comp; locale: string }) {
  const t = useTranslations('compensation');
  const { basic_salary_min: min, basic_salary_max: max } = job;

  if (min == null && max == null) {
    return <span className="text-muted-foreground">{t('commissionOnly')}</span>;
  }

  const value =
    min != null && max != null
      ? t('salaryRange', { min: formatEgp(min, locale), max: formatEgp(max, locale) })
      : min != null
        ? t('salaryFrom', { min: formatEgp(min, locale) })
        : t('salaryUpTo', { max: formatEgp(max!, locale) });

  return (
    <span>
      <span className="numeral font-semibold">{value}</span>{' '}
      <span className="text-muted-foreground">{t('perMonth')}</span>
    </span>
  );
}

export function CommissionLine({ job, locale }: { job: Comp; locale: string }) {
  const t = useTranslations('commissionType');

  if (job.commission_type === 'percentage' && job.commission_value != null) {
    return (
      <span className="numeral">
        {t('percentage', {
          value: new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
            maximumFractionDigits: 2,
          }).format(job.commission_value),
        })}
      </span>
    );
  }

  return <span>{t(job.commission_type)}</span>;
}

export function LeadsSourceBadge({ job }: { job: Pick<JobRow, 'leads_source'> }) {
  const t = useTranslations('leadsSource');

  // Company-provided leads are the strongest signal on the whole card, so it is
  // the only one that gets a filled treatment.
  const variant =
    job.leads_source === 'company_provided'
      ? 'primary'
      : job.leads_source === 'hybrid'
        ? 'outline'
        : 'default';

  return (
    <Badge variant={variant}>
      <Target aria-hidden />
      {t(`${job.leads_source}_short`)}
    </Badge>
  );
}

/**
 * The compensation block, above the fold on the job page, as a structured card
 * rather than a sentence buried in the description.
 */
export function CompensationCard({ job, locale }: { job: Comp; locale: string }) {
  const t = useTranslations('compensation');
  const tBenefit = useTranslations('benefits');
  const tLeads = useTranslations('leadsSource');

  return (
    <section
      aria-labelledby="compensation-heading"
      className="rounded-xl border border-border bg-card"
    >
      <h2
        id="compensation-heading"
        className="border-b border-border px-5 py-3 text-sm font-semibold"
      >
        {t('title')}
      </h2>

      <dl className="grid gap-px bg-border sm:grid-cols-2">
        <div className="bg-card p-5">
          <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Banknote className="size-3.5" aria-hidden />
            {t('basicSalary')}
          </dt>
          <dd className="mt-1.5 text-base">
            <SalaryLine job={job} locale={locale} />
          </dd>
        </div>

        <div className="bg-card p-5">
          <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <HandCoins className="size-3.5" aria-hidden />
            {t('commission')}
          </dt>
          <dd className="mt-1.5 text-base font-semibold">
            <CommissionLine job={job} locale={locale} />
          </dd>
          {job.commission_note_ar ? (
            <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {job.commission_note_ar}
            </dd>
          ) : null}
        </div>

        <div className="bg-card p-5">
          <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Target className="size-3.5" aria-hidden />
            {t('leadsSource')}
          </dt>
          <dd className="mt-1.5 text-base font-semibold">{tLeads(job.leads_source)}</dd>
        </div>

        <div className="bg-card p-5">
          <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden />
            {t('benefits')}
          </dt>
          <dd className="mt-2 flex flex-wrap gap-1.5">
            {job.benefits.length ? (
              job.benefits.map((benefit) => (
                <Badge key={benefit} variant="outline">
                  {tBenefit(benefit)}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">{t('noBenefits')}</span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
