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

/**
 * Hermes has no `crypto`. The web engine does, and its property is read-only:
 * assigning `globalThis.crypto` throws and the Expo web build never starts.
 * Fill in only what is missing, and install an object only where there is none.
 */
export function installCryptoPolyfill(target: { crypto?: CryptoShape } = scope): void {
  const existing = target.crypto;
  const webCrypto: CryptoShape = existing ?? {};
  webCrypto.getRandomValues ??= getRandomValues;
  webCrypto.randomUUID ??= randomUUID;
  webCrypto.subtle ??= {
    digest: (algorithm, data) =>
      digest((typeof algorithm === 'string' ? algorithm : algorithm.name) as CryptoDigestAlgorithm, data),
  };
  if (!existing) target.crypto = webCrypto;
}

installCryptoPolyfill();

installIntlPolyfills();
