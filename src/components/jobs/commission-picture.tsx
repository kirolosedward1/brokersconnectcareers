import { getTranslations } from 'next-intl/server';
import { ArrowLeft, Calculator } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { formatEgp } from '@/lib/utils';
import type { CommissionPicture as Picture } from '@/lib/earnings';

/**
 * The listing's commission rate, answered in the consultant's own numbers.
 *
 * A rate is not an answer. "2.5%" tells a consultant nothing until they know
 * 2.5% of what, and the only honest source for that is the record they typed
 * into their own profile — units closed and total closed value. The average
 * of those two is the deal they actually sell, and the rate against it is a
 * figure they can check against their last commission cheque.
 *
 * Every number on this card came from one of two places: the employer's
 * listing or the reader's own profile. Nothing is modelled, averaged across
 * the market, or projected forward in time — see the note in lib/earnings.ts
 * for why a yearly figure would be a fabrication.
 *
 * The digits are isolated one by one with a rich tag rather than the sentence
 * being wrapped in `.numeral`: forcing a whole Arabic phrase left-to-right
 * reads it backwards, which this codebase has now learned three times.
 */
export async function CommissionPicture({
  picture,
  locale,
}: {
  picture: Picture;
  locale: string;
}) {
  const t = await getTranslations('compensation');

  // Matches CommissionLine: the rate keeps its decimals, the money does not.
  const percent = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    maximumFractionDigits: 2,
  }).format(picture.percent);
  const v = (chunks: React.ReactNode) => <span className="numeral">{chunks}</span>;

  if (picture.kind === 'no_record') {
    return (
      <section className="mt-4 rounded-xl border border-dashed border-border bg-muted/30 p-5">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Calculator className="size-4 text-muted-foreground" aria-hidden />
          {t('earningsTitle')}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t('earningsNoRecord')}
        </p>
        <Link
          href="/dashboard/profile#profile-form"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          {t('earningsNoRecordCta')}
          <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden />
        </Link>
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-xl border border-primary/25 bg-primary/5 p-5">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Calculator className="size-4 text-primary" aria-hidden />
        {t('earningsTitle')}
      </p>

      {picture.kind === 'per_unit' ? (
        <>
          {/* The figure first, at the size of an answer, then the sentence
              that explains where it came from. */}
          <p className="mt-3 text-2xl font-bold">
            <span className="numeral">{formatEgp(picture.perUnit, locale)}</span>{' '}
            <span className="text-base font-medium text-muted-foreground">
              {t('earningsPerUnitSuffix')}
            </span>
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t.rich('earningsPerUnit', {
              average: formatEgp(picture.averageUnit, locale),
              percent,
              v,
            })}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {t.rich('earningsPerUnitBasis', {
              units: formatEgp(picture.units, locale),
              volume: formatEgp(picture.volume, locale),
              v,
            })}
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm leading-relaxed">
          {t.rich('earningsOnTotal', {
            volume: formatEgp(picture.volume, locale),
            percent,
            total: formatEgp(picture.total, locale),
            v,
          })}
        </p>
      )}

      {/* Said plainly, every time. The arithmetic is theirs; the outcome is
          a negotiation with a company that has not made an offer yet. */}
      <p className="mt-3 border-t border-primary/15 pt-3 text-xs leading-relaxed text-muted-foreground">
        {t('earningsNote')}
      </p>
    </section>
  );
}
