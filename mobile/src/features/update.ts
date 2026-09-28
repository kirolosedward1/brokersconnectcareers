import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { useMobileConfig } from '~/features/config';

/**
 * Whether this build is older than the website will still serve. The website
 * says the lowest version it accepts (/api/mobile/v1/config, from
 * MOBILE_MIN_APP_VERSION); below it the app asks to be updated instead of
 * calling an API that has moved on. Unknown — offline, or the answer not in
 * yet — is never "too old": nobody is locked out by a failed request.
 */

/** Dotted versions compared part by part as numbers ("1.10" is after "1.9"); missing parts are 0. */
export function isOlderThan(version: string, minimum: string): boolean {
  const parts = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const have = parts(version);
  const need = parts(minimum);
  for (let index = 0; index < Math.max(have.length, need.length); index += 1) {
    const a = have[index] ?? 0;
    const b = need[index] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}

/** This build's version: the native one, or the config's in a development client. */
export function appVersion(): string | null {
  return Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null;
}

export function useUpdateRequired(): { required: boolean; storeUrl: string | null } {
  const config = useMobileConfig().data;
  const version = appVersion();
  const required = Boolean(config && version && isOlderThan(version, config.minAppVersion));
  return { required, storeUrl: config?.appStoreUrl ?? null };
}
