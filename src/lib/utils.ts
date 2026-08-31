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

/** ISO 8601 date, for schema.org and <time datetime>. */
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
