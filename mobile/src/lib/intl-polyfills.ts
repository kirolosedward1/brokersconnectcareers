/**
 * The Intl the shared formatters assume, on an engine that lacks it.
 *
 * The catalogue has nineteen Arabic plural messages that need
 * `Intl.PluralRules` with Arabic's six categories; the website's formatters
 * use Western digits (`-u-nu-latn`), Cairo's calendar (`timeZone`) and
 * `formatToParts`. Each polyfill is loaded only where the engine's own
 * implementation is missing or incomplete for Arabic or English, as formatjs
 * judges it, so a build whose Hermes grows the feature stops paying for it.
 *
 * The polyfills carry only the locales loaded below, and any other tag falls
 * back to one of them without a word: "en-CA" is answered as "en". That is
 * what broke the job cards once (src/lib/format.ts, formatRelativeDay).
 * British English goes with English because the website's English dates are
 * en-GB — "29 Sept 2026", not "Sep 29, 2026".
 *
 * A language's data is loaded when the app is drawn in it, not before: the
 * app opens in Arabic, and English's tables — 520 KB of the bundle, en and
 * en-GB dates alone 430 KB — were unpacked at every launch for a language the
 * screens never asked for. The polyfill decision itself still weighs both
 * languages, so turning English on never meets a native formatter the
 * polyfills were not judged against. I18nProvider loads its own language
 * (loadIntlLocale) before it draws anything in it.
 *
 * `force` loads every polyfill whatever the engine has. The app's tests run in
 * Node, whose own Intl knows every locale, and force the polyfills, with both
 * languages, so that they format the way the phone does (tests/setup.ts).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- each polyfill and
   each language's data is required only when needed, which an import cannot
   express. Each path is spelled out: Metro bundles only literal requires. */
import { shouldPolyfill as needsCanonicalLocales } from '@formatjs/intl-getcanonicallocales/should-polyfill.js';
import { shouldPolyfill as needsLocale } from '@formatjs/intl-locale/should-polyfill.js';
import { shouldPolyfill as needsPluralRules } from '@formatjs/intl-pluralrules/should-polyfill.js';
import { shouldPolyfill as needsNumberFormat } from '@formatjs/intl-numberformat/should-polyfill.js';
import { shouldPolyfill as needsRelativeTimeFormat } from '@formatjs/intl-relativetimeformat/should-polyfill.js';
import { shouldPolyfill as needsDateTimeFormat } from '@formatjs/intl-datetimeformat/should-polyfill.js';
import { defaultLocale, locales as appLocales, type Locale } from '@/lib/locale';

type Polyfill = 'pluralRules' | 'numberFormat' | 'relativeTimeFormat' | 'dateTimeFormat';

/** Each language's data, per polyfill. */
const LOCALE_DATA: Record<Locale, Record<Polyfill, () => void>> = {
  ar: {
    pluralRules: () => require('@formatjs/intl-pluralrules/locale-data/ar.js'),
    numberFormat: () => require('@formatjs/intl-numberformat/locale-data/ar.js'),
    relativeTimeFormat: () => require('@formatjs/intl-relativetimeformat/locale-data/ar.js'),
    dateTimeFormat: () => require('@formatjs/intl-datetimeformat/locale-data/ar.js'),
  },
  en: {
    pluralRules: () => require('@formatjs/intl-pluralrules/locale-data/en.js'),
    numberFormat: () => require('@formatjs/intl-numberformat/locale-data/en.js'),
    relativeTimeFormat: () => require('@formatjs/intl-relativetimeformat/locale-data/en.js'),
    dateTimeFormat: () => {
      require('@formatjs/intl-datetimeformat/locale-data/en.js');
      require('@formatjs/intl-datetimeformat/locale-data/en-GB.js');
    },
  },
};

/** The polyfills this engine was given; their languages' data follows. */
const installed = new Set<Polyfill>();
const loadedLocales = new Set<Locale>();

/** Whether either language needs the polyfill (formatjs answers with the locale to load, or nothing). */
const needs = (check: (locale: string) => unknown) => appLocales.some((locale) => Boolean(check(locale)));

export function installIntlPolyfills({
  force = false,
  locales = [defaultLocale],
}: { force?: boolean; locales?: readonly Locale[] } = {}): void {
  // Order matters: each of these builds on the ones before it.
  if (force || needsCanonicalLocales()) {
    // From the package's index, which the Locale polyfill imports anyway. Its
    // polyfill-force.js is a second, self-contained copy of the same module —
    // 160 KB of the bundle twice over — that does nothing more than this.
    const { getCanonicalLocales } = require('@formatjs/intl-getcanonicallocales') as typeof import('@formatjs/intl-getcanonicallocales');
    Object.defineProperty(Intl, 'getCanonicalLocales', {
      value: getCanonicalLocales,
      configurable: true,
      enumerable: false,
      writable: true,
    });
  }
  if (force || needsLocale()) require('@formatjs/intl-locale/polyfill-force.js');

  if (force || needs(needsPluralRules)) {
    require('@formatjs/intl-pluralrules/polyfill-force.js');
    installed.add('pluralRules');
  }

  if (force || needs(needsNumberFormat)) {
    require('@formatjs/intl-numberformat/polyfill-force.js');
    installed.add('numberFormat');
  }

  if (force || needs(needsRelativeTimeFormat)) {
    require('@formatjs/intl-relativetimeformat/polyfill-force.js');
    installed.add('relativeTimeFormat');
  }

  if (force || needs(needsDateTimeFormat)) {
    require('@formatjs/intl-datetimeformat/polyfill-force.js');
    installed.add('dateTimeFormat');
    // Cairo's zone alone. Every date is written in Cairo's calendar — the
    // shared formatters and the catalogue's dates alike (TIME_ZONE in
    // ../i18n/provider.tsx) — and the polyfill's smallest set of zones, its
    // "golden" 246, was 800 KB unpacked at every launch. ./cairo-tz.json is
    // that set's own Cairo entry (scripts/cairo-tz.mjs). A formatter asked for
    // any other zone would write UTC, or refuse the name; none is asked.
    (Intl.DateTimeFormat as unknown as { __addTZData: (data: unknown) => void }).__addTZData(
      require('./cairo-tz.json'),
    );
  }

  // The first language loaded is each polyfill's default: Arabic, as before.
  for (const locale of locales) loadIntlLocale(locale);
}

/**
 * A language's data for every polyfill this engine was given. Once per
 * language; nothing at all where the engine formats natively.
 */
export function loadIntlLocale(locale: Locale): void {
  if (loadedLocales.has(locale)) return;
  loadedLocales.add(locale);
  for (const polyfill of installed) LOCALE_DATA[locale][polyfill]();
}
