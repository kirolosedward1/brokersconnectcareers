import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
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

/** The version Account shows: in Expo Go the app's own, where the native one is Expo Go's. */
export function shownVersion(): string | null {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return Constants.expoConfig?.version ?? null;
  return appVersion();
}

/**
 * When the code this phone runs was published: its update's time, or the
 * build's for the code the build shipped with. Shown under the version, so a
 * phone can be checked against the newest publish at a glance — Expo Go keeps
 * running the copy it opened until it is opened afresh.
 */
export function publishedAt(): Date | null {
  const manifest = Constants.manifest2 as { createdAt?: string } | null | undefined;
  const at = Updates.createdAt ?? (manifest?.createdAt ? new Date(manifest.createdAt) : null);
  return at && !Number.isNaN(at.getTime()) ? at : null;
}

/**
 * Each platform against its own floor and its own store: Android's builds are
 * released apart from the iPhone's, and the App Store is no use on Android.
 * A website that does not yet say Android's floor gives the iPhone's.
 */
export function useUpdateRequired(): { required: boolean; storeUrl: string | null } {
  const config = useMobileConfig().data;
  const version = appVersion();
  const android = Platform.OS === 'android';
  const minimum = android ? (config?.minAndroidAppVersion ?? config?.minAppVersion) : config?.minAppVersion;
  const required = Boolean(minimum && version && isOlderThan(version, minimum));
  return { required, storeUrl: (android ? config?.playStoreUrl : config?.appStoreUrl) ?? null };
}
