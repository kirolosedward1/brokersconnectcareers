/**
 * "مارس 2026" — a month and its year, in Cairo's calendar, with Western
 * digits as every date the product writes: for «موثّقة منذ مارس 2026».
 * Made once per locale and kept, as format.ts keeps its own.
 */
const made = new Map<string, Intl.DateTimeFormat>();

export function formatMonthYear(value: string | Date, locale: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const tag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
  let format = made.get(tag);
  if (!format) {
    format = new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' });
    made.set(tag, format);
  }
  return format.format(date);
}
