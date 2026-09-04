import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { formatNumber } from '@/lib/utils';
import type { EmployerConversionRow } from '@/lib/supabase/database.types';

/**
 * How each live listing turns views into applications.
 *
 * A comparison rather than a trend, and deliberately so: views are a counter
 * on the listing with no date attached, so there is no history to plot. What
 * an employer can act on is which of the listings running right now is
 * converting and which is being read and skipped — and that is answerable
 * today, out of data that already exists.
 *
 * Bars are scaled against the best rate in the list, not against 100%. A
 * two-percent conversion is normal for a job listing, so a bar drawn to a
 * hundred would be a row of slivers with nothing to compare.
 */
export async function ConversionBars({
  rows,
  locale,
}: {
  rows: EmployerConversionRow[];
  locale: string;
}) {
  const t = await getTranslations('dashboard');
  const n = (value: number) => formatNumber(value, locale);

  const rate = (row: EmployerConversionRow) =>
    row.views > 0 ? row.applications / row.views : null;

  const best = Math.max(0, ...rows.map((row) => rate(row) ?? 0));

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="font-semibold">{t('conversionTitle')}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{t('conversionHint')}</p>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{t('conversionEmpty')}</p>
      ) : (
        <ul className="mt-5 space-y-4">
          {rows.map((row) => {
            const value = rate(row);
            // A listing nobody has opened yet is not a zero-percent listing;
            // it is a listing with no answer, and the bar says so by being
            // absent rather than empty.
            const width = value != null && best > 0 ? Math.max(4, (value / best) * 100) : 0;

            return (
              <li key={row.id}>
                <Link
                  href={`/employer/jobs/${row.id}/applicants`}
                  className="group/row block rounded-xl p-2 -m-2 transition-colors hover:bg-muted"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium group-hover/row:text-primary">
                      {localized(locale, row.title_ar, row.title_en)}
                    </span>
                    <span className="numeral shrink-0 text-sm font-semibold">
                      {value == null ? '—' : `${n(Math.round(value * 1000) / 10)}%`}
                    </span>
                  </div>

                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="bg-brand-gradient h-full rounded-full"
                      style={{ width: `${width}%` }}
                    />
                  </div>

                  <p className="numeral mt-1.5 text-xs text-muted-foreground">
                    {t('conversionCounts', {
                      applications: n(row.applications),
                      views: n(row.views),
                    })}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Link
        href="/employer/jobs"
        className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        {t('conversionAll')}
        <ArrowLeft className="rtl-flip size-3.5" aria-hidden />
      </Link>
    </section>
  );
}
