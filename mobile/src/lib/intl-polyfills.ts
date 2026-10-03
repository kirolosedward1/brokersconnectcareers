/**
 * The Intl the shared formatters assume, on an engine that lacks it.
 *
 * The catalogue has nineteen Arabic plural messages that need
 * `Intl.PluralRules` with Arabic's six categories; the website's formatters
 * use Western digits (`-u-nu-latn`), Cairo's calendar (`timeZone`) and
 * `formatToParts`. Each polyfill is loaded only where the engine's own
 * implementation is missing or incomplete for Arabic, as formatjs judges it,
 * so a build whose Hermes grows the feature stops paying for it.
 *
 * The polyfills carry only the locales loaded below, and any other tag falls
 * back to one of them without a word: "en-CA" is answered as "en". That is
 * what broke the job cards once (src/lib/format.ts, formatRelativeDay).
 * British English is here because the website's English dates are en-GB —
 * "29 Sept 2026", not "Sep 29, 2026".
 *
 * `force` loads every one whatever the engine has. The app's tests run in
 * Node, whose own Intl knows every locale, and force the polyfills so that they
 * format the way the phone does (tests/setup.ts).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- each polyfill is
   required only when the engine needs it, which an import cannot express. */
import { shouldPolyfill as needsCanonicalLocales } from '@formatjs/intl-getcanonicallocales/should-polyfill.js';
import { shouldPolyfill as needsLocale } from '@formatjs/intl-locale/should-polyfill.js';
import { shouldPolyfill as needsPluralRules } from '@formatjs/intl-pluralrules/should-polyfill.js';
import { shouldPolyfill as needsNumberFormat } from '@formatjs/intl-numberformat/should-polyfill.js';
import { shouldPolyfill as needsRelativeTimeFormat } from '@formatjs/intl-relativetimeformat/should-polyfill.js';
import { shouldPolyfill as needsDateTimeFormat } from '@formatjs/intl-datetimeformat/should-polyfill.js';

export function installIntlPolyfills({ force = false }: { force?: boolean } = {}): void {
  // Order matters: each of these builds on the ones before it.
  if (force || needsCanonicalLocales()) require('@formatjs/intl-getcanonicallocales/polyfill-force.js');
  if (force || needsLocale()) require('@formatjs/intl-locale/polyfill-force.js');

  if (force || needsPluralRules('ar') || needsPluralRules('en')) {
    require('@formatjs/intl-pluralrules/polyfill-force.js');
    require('@formatjs/intl-pluralrules/locale-data/ar.js');
    require('@formatjs/intl-pluralrules/locale-data/en.js');
  }

  if (force || needsNumberFormat('ar') || needsNumberFormat('en')) {
    require('@formatjs/intl-numberformat/polyfill-force.js');
    require('@formatjs/intl-numberformat/locale-data/ar.js');
    require('@formatjs/intl-numberformat/locale-data/en.js');
  }

  if (force || needsRelativeTimeFormat('ar') || needsRelativeTimeFormat('en')) {
    require('@formatjs/intl-relativetimeformat/polyfill-force.js');
    require('@formatjs/intl-relativetimeformat/locale-data/ar.js');
    require('@formatjs/intl-relativetimeformat/locale-data/en.js');
  }

  if (force || needsDateTimeFormat('ar') || needsDateTimeFormat('en')) {
    require('@formatjs/intl-datetimeformat/polyfill-force.js');
    require('@formatjs/intl-datetimeformat/locale-data/ar.js');
    require('@formatjs/intl-datetimeformat/locale-data/en.js');
    require('@formatjs/intl-datetimeformat/locale-data/en-GB.js');
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
}
