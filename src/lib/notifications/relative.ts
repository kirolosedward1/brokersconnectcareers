import { formatRelativeDay, readDate } from '@/lib/format';

/**
 * How long ago a notification happened, in the reader's language.
 *
 * Minutes, hours and days come from `Intl.RelativeTimeFormat` with Western
 * digits, which is what writes «قبل 5 دقائق» and "5 minutes ago". Under a
 * minute is "الآن" / "Just now": formatting zero seconds says "in 0 seconds",
 * which is not a time that has passed. Past a month, the same day-and-month
 * the rest of the product uses.
 */
const tagOf = (locale: string) => (locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');

const formatters = new Map<string, Intl.RelativeTimeFormat>();

function relative(locale: string): Intl.RelativeTimeFormat {
  const tag = tagOf(locale);
  let made = formatters.get(tag);
  if (!made) {
    made = new Intl.RelativeTimeFormat(tag, { numeric: 'always' });
    formatters.set(tag, made);
  }
  return made;
}

export function formatBellTime(value: string | Date, locale: string, now: Date = new Date()): string {
  const date = readDate(value);
  if (!date) return '';
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return locale === 'ar' ? 'الآن' : 'Just now';
  const format = relative(locale);
  if (abs < 3600) return format.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86_400 * 30) return format.format(Math.round(seconds / 86_400), 'day');
  return formatRelativeDay(date, locale, now);
}
