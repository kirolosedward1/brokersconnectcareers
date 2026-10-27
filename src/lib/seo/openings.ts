import { getTranslations } from 'next-intl/server';
import { formatNumber } from '@/lib/format';
import { optional } from '@/lib/queries/error';
import { getBrowseCounts } from '@/lib/queries/browse';

/**
 * The sitelink lead, "{count} وظيفة متاحة الآن.", from the live board.
 *
 * Pass `total` when the page already counted its own openings (a landing).
 * Zero, or a read that failed, leaves the lead off so the description stays
 * the page's own sentence.
 */
export async function openingsLead(locale: string, total?: number): Promise<string> {
  const count = total ?? (await optional(getBrowseCounts(), null))?.total ?? 0;
  if (count <= 0) return '';
  const t = await getTranslations({ locale, namespace: 'meta' });
  return t('openingsLead', { count: formatNumber(count, locale) });
}
