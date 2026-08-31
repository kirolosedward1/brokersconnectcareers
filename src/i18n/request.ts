import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    formats: {
      // Western numerals in both locales — 1234, not ١٢٣٤. This is the web
      // convention in Egypt for prices, dates and counts.
      number: {
        egp: { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 },
      },
      dateTime: {
        short: { day: 'numeric', month: 'short', year: 'numeric' },
      },
    },
  };
});
