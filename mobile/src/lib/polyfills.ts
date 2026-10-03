/**
 * What Hermes lacks and the shared code assumes.
 *
 * Loaded first, from index.js, before any module that formats or fetches.
 *
 * Intl: see ./intl-polyfills.ts — the formatjs polyfills, each only where the
 * engine needs it.
 *
 * URL and WebCrypto: supabase-js builds URLs and signs its PKCE challenge
 * with `crypto.subtle.digest`; without it the challenge falls back to "plain".
 * The website's uuid() reads `crypto.getRandomValues`.
 */
import 'react-native-url-polyfill/auto';

import { digest, getRandomValues, randomUUID, type CryptoDigestAlgorithm } from 'expo-crypto';
import { installIntlPolyfills } from './intl-polyfills';

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

installIntlPolyfills();
