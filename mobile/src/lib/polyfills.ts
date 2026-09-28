/**
 * What Hermes lacks and the shared code assumes.
 *
 * Loaded first, from index.js, before any module that formats or fetches.
 *
 * Intl: the catalogue has nineteen Arabic plural messages that need
 * `Intl.PluralRules` with Arabic's six categories; the website's formatters
 * use Western digits (`-u-nu-latn`), Cairo's calendar (`timeZone`) and
 * `formatToParts`. Each polyfill is loaded only where the engine's own
 * implementation is missing or incomplete for Arabic, as formatjs judges it,
 * so a build whose Hermes grows the feature stops paying for it.
 *
 * URL and WebCrypto: supabase-js builds URLs and signs its PKCE challenge
 * with `crypto.subtle.digest`; without it the challenge falls back to "plain".
 * The website's uuid() reads `crypto.getRandomValues`.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- each polyfill is
   required only when the engine needs it, which an import cannot express. */
import 'react-native-url-polyfill/auto';

import { digest, getRandomValues, randomUUID, type CryptoDigestAlgorithm } from 'expo-crypto';
import { shouldPolyfill as needsCanonicalLocales } from '@formatjs/intl-getcanonicallocales/should-polyfill.js';
import { shouldPolyfill as needsLocale } from '@formatjs/intl-locale/should-polyfill.js';
import { shouldPolyfill as needsPluralRules } from '@formatjs/intl-pluralrules/should-polyfill.js';
import { shouldPolyfill as needsNumberFormat } from '@formatjs/intl-numberformat/should-polyfill.js';
import { shouldPolyfill as needsRelativeTimeFormat } from '@formatjs/intl-relativetimeformat/should-polyfill.js';
import { shouldPolyfill as needsDateTimeFormat } from '@formatjs/intl-datetimeformat/should-polyfill.js';

type CryptoShape = {
  getRandomValues?: typeof getRandomValues;
  randomUUID?: typeof randomUUID;
  subtle?: { digest: (algorithm: string | { name: string }, data: BufferSource) => Promise<ArrayBuffer> };
};

const scope = globalThis as unknown as { crypto?: CryptoShape };
const webCrypto: CryptoShape = scope.crypto ?? {};
webCrypto.getRandomValues ??= getRandomValues;
webCrypto.randomUUID ??= randomUUID;
webCrypto.subtle ??= {
  digest: (algorithm, data) =>
    digest((typeof algorithm === 'string' ? algorithm : algorithm.name) as CryptoDigestAlgorithm, data),
};
scope.crypto = webCrypto;

// Order matters: each of these builds on the ones before it.
if (needsCanonicalLocales()) require('@formatjs/intl-getcanonicallocales/polyfill-force.js');
if (needsLocale()) require('@formatjs/intl-locale/polyfill-force.js');

if (needsPluralRules('ar') || needsPluralRules('en')) {
  require('@formatjs/intl-pluralrules/polyfill-force.js');
  require('@formatjs/intl-pluralrules/locale-data/ar.js');
  require('@formatjs/intl-pluralrules/locale-data/en.js');
}

if (needsNumberFormat('ar') || needsNumberFormat('en')) {
  require('@formatjs/intl-numberformat/polyfill-force.js');
  require('@formatjs/intl-numberformat/locale-data/ar.js');
  require('@formatjs/intl-numberformat/locale-data/en.js');
}

if (needsRelativeTimeFormat('ar') || needsRelativeTimeFormat('en')) {
  require('@formatjs/intl-relativetimeformat/polyfill-force.js');
  require('@formatjs/intl-relativetimeformat/locale-data/ar.js');
  require('@formatjs/intl-relativetimeformat/locale-data/en.js');
}

if (needsDateTimeFormat('ar') || needsDateTimeFormat('en')) {
  require('@formatjs/intl-datetimeformat/polyfill-force.js');
  require('@formatjs/intl-datetimeformat/locale-data/ar.js');
  require('@formatjs/intl-datetimeformat/locale-data/en.js');
  // Africa/Cairo is in the golden set; the whole database is not needed.
  require('@formatjs/intl-datetimeformat/add-golden-tz.js');
}
