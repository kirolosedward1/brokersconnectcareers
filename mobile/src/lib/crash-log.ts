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

/** The last few failures the app went on from, newest last; in memory only. */
const failures: string[] = [];
const FAILURES_KEPT = 5;

/**
 * A failure the app went on from, with what went wrong underneath ("storage:
 * new row violates…") — words for whoever reads a crash report, never for the
 * screen, which says in plain words what did not happen. Kept for this run
 * only, and sent with the report if the app goes down after it; in a
 * development build it is also said in the console.
 */
export function noteFailure(where: string, failure: unknown) {
  const detail = failure instanceof Error ? failure.message : String(failure ?? '');
  const line = `${new Date().toISOString()} ${where}: ${detail}`.slice(0, 500);
  failures.push(line);
  if (failures.length > FAILURES_KEPT) failures.shift();
  if (__DEV__) console.warn(line);
}

/** For tests and the report: the failures noted in this run. */
export function notedFailures(): readonly string[] {
  return failures;
}

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
      // What failed before it, which the screen said only in plain words.
      stack: [(failure.stack ?? '').slice(0, 2500), ...(failures.length ? ['', 'Earlier:', ...failures] : [])].join('\n'),
      fatal: Boolean(fatal),
      at: new Date().toISOString(),
      version: Constants.expoConfig?.version ?? '',
    };
    // Only what closes the app is kept: a non-fatal error is already shown where it happened.
    if (crash.fatal) AsyncStorage.setItem(KEY, JSON.stringify(crash)).catch(() => {});
    previous(error, Boolean(fatal));
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
