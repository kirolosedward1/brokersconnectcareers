import type { JobRow } from '@/lib/supabase/database.types';

/**
 * What a listing's commission is worth against a consultant's own record.
 *
 * Every advert in this market says "عمولات مغرية". This board already refuses
 * that by printing the rate — and a rate on its own is still not an answer,
 * because 2.5% means nothing until you know 2.5% of what. The consultant
 * already told us: units closed and total closed value, in their own profile.
 * Dividing one by the other gives the average unit they actually sell, and the
 * rate against that is a number they can check against their last commission
 * cheque.
 *
 * What this deliberately does NOT do is invent a salary. `volume_egp` is
 * documented as *total* closed value, not annual, so multiplying it by a rate
 * and calling the result a yearly income would be a fabrication dressed as
 * arithmetic — the exact thing this product exists not to do. There is no time
 * dimension here at all: one deal in, one commission out.
 *
 * Nothing is computed unless the employer published a real percentage. A
 * 'split' or 'undisclosed' commission is not a number, and guessing at one
 * would put words in the company's mouth.
 */

type Comp = Pick<JobRow, 'commission_type' | 'commission_value'>;

/** The two figures a consultant enters on their own profile. Both optional. */
export type SalesRecord = {
  unitsClosed: number | null;
  volumeEgp: number | null;
};

export type CommissionPicture =
  /** Both figures present: the strongest form, a commission per deal. */
  | { kind: 'per_unit'; percent: number; units: number; volume: number; averageUnit: number; perUnit: number }
  /** Value but no unit count, so there is no average deal — only the total. */
  | { kind: 'on_total'; percent: number; volume: number; total: number }
  /** A real rate, and nothing of theirs to measure it against yet. */
  | { kind: 'no_record'; percent: number };

export function commissionPicture(job: Comp, record: SalesRecord): CommissionPicture | null {
  // Only a published percentage is arithmetic. Everything else is a word.
  if (job.commission_type !== 'percentage') return null;

  const percent = job.commission_value;
  if (percent == null || !Number.isFinite(percent) || percent <= 0) return null;

  const units = record.unitsClosed ?? 0;
  const volume = record.volumeEgp ?? 0;

  // No value closed means no basis. Units alone cannot price a deal.
  if (volume <= 0) return { kind: 'no_record', percent };

  if (units > 0) {
    const averageUnit = Math.round(volume / units);
    return {
      kind: 'per_unit',
      percent,
      units,
      volume,
      averageUnit,
      perUnit: Math.round((averageUnit * percent) / 100),
    };
  }

  return { kind: 'on_total', percent, volume, total: Math.round((volume * percent) / 100) };
}
