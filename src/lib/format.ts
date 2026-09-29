/**
 * Numbers, dates, lists and short text, formatted the way the product formats
 * them — in both languages, in Cairo's calendar, with Western digits.
 *
 * The pure half of `utils.ts`, which re-exports all of it: the web's imports
 * are unchanged. Split out because `utils.ts` also carries `cn()`, and with it
 * Tailwind's class merger, which the mobile app has no use for. The app
 * formats through these same functions so a salary, a date or "3 days ago"
 * reads the same on the phone as on the site.
 *
 * Imports nothing.
 */

/**
 * Western numerals in both locales — 1234, not ١٢٣٤. This is the web convention
 * in Egypt for prices, dates and counts, so every formatter is pinned to the
 * `-u-nu-latn` numbering system rather than trusting the locale default.
 */
const NUMBER_LOCALE = (locale: string) => (locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(NUMBER_LOCALE(locale)).format(value);
}

export function formatEgp(value: number, locale: string): string {
  return new Intl.NumberFormat(NUMBER_LOCALE(locale), { maximumFractionDigits: 0 }).format(value);
}

/**
 * "14 أغسطس 2026" — day, month, year — the same string in every browser.
 *
 * Assembled from its parts rather than taken whole, because the whole is not
 * the same everywhere. Safari's ICU writes the Arabic pattern with a comma
 * after the month, "14 أغسطس، 2026", where Node, Chrome and Firefox write
 * none. A client component formats once on the server and again in the
 * browser, so on Safari — every iPhone — the two disagreed, React threw away
 * the server's HTML, and the employer's applicant list was rebuilt on every
 * load. The parts (the digits, the month's name) agree in every engine; only
 * the pattern did not.
 *
 * And in Cairo's calendar, like formatRelativeDay below: the server renders in
 * UTC, so an application sent at 1am in Cairo was dated the day before on the
 * server and the day itself in the browser.
 */
export function formatDate(value: string | Date, locale: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat(NUMBER_LOCALE(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Cairo',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}`;
}

/**
 * How long ago, to the day — "today", "yesterday", "3 days ago" — and the plain
 * date once it is older than a month.
 *
 * Calendar days in Cairo, not elapsed 24-hour periods. Flooring the
 * millisecond difference called a listing posted at 11pm "today" at 9am the
 * next morning, and the server renders in UTC, which in Egypt is two or three
 * hours behind the reader's own midnight. Both dates are read off Cairo's
 * calendar and the whole days between them are counted, which is also what
 * keeps the answer stable across a daylight-saving change.
 *
 * Past thirty days "41 days ago" is arithmetic the reader has to undo, so it
 * becomes the date.
 */
const CAIRO_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function cairoDayNumber(date: Date): number {
  const [year, month, day] = CAIRO_DAY.format(date).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function formatRelativeDay(
  value: string | Date,
  locale: string,
  now: Date = new Date(),
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const days = cairoDayNumber(now) - cairoDayNumber(date);

  if (days > 30 || days < 0) return formatDayMonth(date, locale);

  return new Intl.RelativeTimeFormat(NUMBER_LOCALE(locale), { numeric: 'auto' }).format(
    -days,
    'day',
  );
}

/** Day and month only — for a chart axis, where the year is the same on every tick. */
export function formatDayMonth(value: string | Date, locale: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(NUMBER_LOCALE(locale), {
    day: 'numeric',
    month: 'short',
    // Cairo's calendar, for the reason given on formatDate.
    timeZone: 'Africa/Cairo',
  }).format(date);
}

/**
 * Join a row of tags with the separator the reader's language uses.
 *
 * Three components did this with `.join('، ')` — the Arabic comma, spelled
 * into the component. Right in Arabic and wrong in English, where a
 * consultant's districts would have read "Fifth Settlement، Nasr City".
 *
 * Not `Intl.ListFormat`, which was the first attempt and is the wrong tool
 * twice over. These are tag rows — a card's districts, a profile's tracks —
 * and CLDR's list patterns are for prose: Arabic comes back as
 * "التجمع، ومدينة نصر، والمعادي", with a conjunction before every item, and
 * there is no Arabic option that gives a bare comma. In English the narrow
 * unit form drops the separator altogether and returns
 * "Fifth Settlement Nasr City". A separator is all this needed.
 */
export function formatList(items: readonly string[], locale: string): string {
  return items.join(locale === 'ar' ? '، ' : ', ');
}

/** ISO 8601 date, for schema.org and <time datetime>. */
export function isoDate(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

/** Strips markup and collapses whitespace, for meta descriptions. */
export function toPlainText(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * next-intl's named formats — `{amount, number, egp}` in a message, and the
 * short date. The web passes these to next-intl in `src/i18n/request.ts`; the
 * app passes the same object to use-intl.
 */
export const intlFormats = {
  // Western numerals in both locales — 1234, not ١٢٣٤. This is the web
  // convention in Egypt for prices, dates and counts.
  number: {
    egp: { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 },
  },
  dateTime: {
    short: { day: 'numeric', month: 'short', year: 'numeric' },
  },
} as const;
