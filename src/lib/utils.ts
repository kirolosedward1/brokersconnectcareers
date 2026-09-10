import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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

export function formatDate(value: string | Date, locale: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(NUMBER_LOCALE(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** Day and month only — for a chart axis, where the year is the same on every tick. */
export function formatDayMonth(value: string | Date, locale: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(NUMBER_LOCALE(locale), {
    day: 'numeric',
    month: 'short',
  }).format(date);
}

/** ISO 8601 date, for schema.org and <time datetime>. */
/**
 * A v4 UUID, on browsers that do not have `crypto.randomUUID`.
 *
 * Four upload paths built their storage key with `crypto.randomUUID()` — the
 * CV on the apply form, the CV on the profile, the company logo, and the
 * verification documents. It is Chrome 92 and Safari 15.4, both 2022, and it
 * is also only defined in a secure context. Most phones have it. The ones that
 * do not are the in-app browsers — a job seeker arriving from a Facebook or
 * Instagram ad opens the site inside one, and this platform's traffic comes
 * from exactly there — where an older WebView means `crypto.randomUUID is not
 * a function`, thrown inside a transition, with nothing on screen to say the
 * upload never started.
 *
 * `getRandomValues` is from 2011 and needs no such caution, so the fallback is
 * a real v4 rather than a weaker id. Math.random is the last resort and only
 * matters for a browser that has neither, where these are path segments in a
 * private bucket that RLS already confines to one account — the id is not what
 * keeps a CV private.
 */
export function uuid(): string {
  const source = globalThis.crypto;
  if (typeof source?.randomUUID === 'function') return source.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof source?.getRandomValues === 'function') {
    source.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  // Version 4, variant 1 — the two bytes that make it a well-formed v4.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

export function isoDate(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Contact in this market is WhatsApp, not email. wa.me wants a bare
 * international number with no `+` and no separators.
 */
export function whatsappLink(phone: string, message?: string): string {
  const digits = phone.replace(/\D/g, '');
  const query = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${digits}${query}`;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

/** Strips markup and collapses whitespace, for meta descriptions. */
export function toPlainText(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
