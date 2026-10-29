import { useMemo } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { formatEgp } from '@/lib/format';
import { isolate, markupTags } from '~/i18n/rich';

/**
 * Every amount of money the app writes, in one place: always with its
 * currency — «ج.م» in Arabic, "EGP" in English — never a bare number.
 *
 * The website's catalogue says «جنيه» in its own sentences; the app's
 * figures and cards use the short mark, from its own strings (`app.money`).
 * A range is one left-to-right run, low to high, as a number is (Num).
 */
export function useMoney() {
  const t = useTranslations('app.money');
  const locale = useLocale();
  return useMemo(() => {
    const egp = (value: number) => formatEgp(value, locale);
    return {
      /** «ج.م» / "EGP". */
      unit: t('unit'),
      /** «ج.م / شهر» / "EGP / month": beside figures that are a monthly pay. */
      perMonth: t('perMonth'),
      /** "12,000 ج.م". */
      amount: (value: number) => t.markup('amount', { amount: egp(value), ...markupTags }),
      /** "12,000", isolated: the figure alone, for a line that sets the unit beside it itself. */
      figure: (value: number) => isolate(egp(value)),
      /**
       * A pay as a whole phrase with its currency: "12,000 – 18,000 ج.م",
       * "من 12,000 ج.م", "حتى 18,000 ج.م"; null when neither end is known.
       */
      pay: (min: number | null, max: number | null): string | null => {
        if (min != null && max != null) return t.markup('range', { min: egp(min), max: egp(max), ...markupTags });
        if (min != null) return t.markup('from', { min: egp(min), ...markupTags });
        if (max != null) return t.markup('upTo', { max: egp(max), ...markupTags });
        return null;
      },
      /**
       * The same pay without its currency, for a card that sets the figures
       * large and the unit small beside them (`perMonth`).
       */
      figures: (min: number | null, max: number | null): string | null => {
        if (min != null && max != null) return t.markup('rangeFigures', { min: egp(min), max: egp(max), ...markupTags });
        if (min != null) return t.markup('fromFigures', { min: egp(min), ...markupTags });
        if (max != null) return t.markup('upToFigures', { max: egp(max), ...markupTags });
        return null;
      },
    };
  }, [t, locale]);
}
