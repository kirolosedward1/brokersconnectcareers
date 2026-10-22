import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import type { ErrorUtils } from 'react-native';

const KEY = 'bc.last-crash.v1';

export type Crash = {
  message: string;
  stack: string;
  fatal: boolean;
  at: string;
  version: string;
};

/**
 * What took the app down last, kept on the phone for the next launch to say
 * (src/components/navigation/crash-notice.tsx). React's error boundaries catch
 * what goes wrong while a screen draws; an error thrown by a press, a timer or
 * an answer from the server reaches React Native's own handler instead, which
 * in Expo Go closes the app with nothing to show for it. Recorded here first,
 * then handed on as before. The JavaScript only: a crash inside iOS itself
 * leaves nothing for the app to read.
 */
export function installCrashLog() {
  const handler = (globalThis as { ErrorUtils?: ErrorUtils }).ErrorUtils;
  if (!handler) return;
  const previous = handler.getGlobalHandler();
  handler.setGlobalHandler((error: unknown, fatal?: boolean) => {
    const failure = error instanceof Error ? error : new Error(String(error));
    const crash: Crash = {
      message: failure.message.slice(0, 500),
      stack: (failure.stack ?? '').slice(0, 2500),
      fatal: Boolean(fatal),
      at: new Date().toISOString(),
      version: Constants.expoConfig?.version ?? '',
    };
    // Only what closes the app is kept: a non-fatal error is already shown where it happened.
    if (crash.fatal) AsyncStorage.setItem(KEY, JSON.stringify(crash)).catch(() => {});
    previous(error, fatal);
  });
}

/** The crash kept from the last run, if any. */
export async function readLastCrash(): Promise<Crash | null> {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (!stored) return null;
    const crash = JSON.parse(stored) as Partial<Crash>;
    return typeof crash.message === 'string' ? (crash as Crash) : null;
  } catch {
    return null;
  }
}

export async function forgetLastCrash() {
  await AsyncStorage.removeItem(KEY).catch(() => {});
}

/** The crash as text to send: what, where in the code, when, which version. */
export function crashReport(crash: Crash): string {
  return [`${crash.message}`, `${crash.at} · ${crash.version}`, '', crash.stack].join('\n');
}
