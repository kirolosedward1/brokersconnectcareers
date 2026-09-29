import type { ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import { intlFormats } from '@/lib/format';
import { defaultLocale, type Locale } from '@/lib/locale';
import webAr from '../../../messages/ar.json';
import webEn from '../../../messages/en.json';
import appAr from './messages/ar.json';
import appEn from './messages/en.json';

/**
 * The website's message catalogue, word for word, plus the app's own strings.
 *
 * The app reads the same ar.json and en.json the website does, through
 * use-intl — next-intl's own core — so a plural, a salary and "3 days ago" come
 * out exactly as they do on the site, and a wording change reaches both. The
 * few strings only the app needs (tab names, "no connection") live under the
 * `app` namespace in ./messages, with the same two-languages-one-shape rule.
 *
 * Arabic, right to left, in Cairo's calendar — the website's defaults.
 */
export const catalogues = {
  ar: { ...webAr, app: appAr },
  en: { ...webEn, app: appEn },
} as const;

export type Messages = (typeof catalogues)['ar'];

export const TIME_ZONE = 'Africa/Cairo';

export function I18nProvider({ locale = defaultLocale, children }: { locale?: Locale; children: ReactNode }) {
  return (
    <IntlProvider
      locale={locale}
      messages={catalogues[locale]}
      formats={intlFormats}
      timeZone={TIME_ZONE}
      onError={(error) => {
        if (__DEV__) console.warn(`[i18n] ${error.code}: ${error.message}`);
      }}
      getMessageFallback={({ namespace, key }) => (namespace ? `${namespace}.${key}` : key)}
    >
      {children}
    </IntlProvider>
  );
}
