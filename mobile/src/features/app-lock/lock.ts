import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';

/**
 * The app lock: Face ID (or the phone's passcode) before the app opens, for
 * whoever turned it on, on this phone — Account → Sign-in and security.
 *
 * A phone left unlocked on a desk opens straight into an employer's
 * applicants, their numbers and CVs, or a candidate's applications. The
 * session itself is sealed (session-storage.ts), but it is meant to open
 * without asking; this is the person's own choice to be asked.
 *
 * Kept on the phone, per account: the ids of the people who turned it on
 * here. Another person signing in on the same phone is not locked by a choice
 * that was not theirs. Never an authority — the database decides what any
 * request may see — only a door in front of the screens.
 */
const KEY = 'bc.app-lock.v1';

/** Back from the background after this long, the app asks again. */
export const LOCK_AFTER_MS = 60_000;

let users: ReadonlySet<string> = new Set();
let loaded = false;
/** Who has given the phone's check (or signed in) since the app last locked; nobody at launch. */
let provenFor: string | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function loadAppLock(): Promise<void> {
  loading ??= AsyncStorage.getItem(KEY)
    .then((stored) => {
      const parsed = stored ? (JSON.parse(stored) as unknown) : [];
      if (Array.isArray(parsed)) {
        users = new Set([...users, ...parsed.filter((id): id is string => typeof id === 'string')]);
      }
    })
    .catch(() => {})
    .finally(() => {
      loaded = true;
      emit();
    });
  return loading;
}

export async function setAppLock(userId: string, on: boolean): Promise<void> {
  const next = new Set(users);
  if (on) next.add(userId);
  else next.delete(userId);
  users = next;
  emit();
  await AsyncStorage.setItem(KEY, JSON.stringify([...next]));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the phone has said who turned the lock on; read once, at launch. */
export function useAppLockLoaded(): boolean {
  useEffect(() => {
    loadAppLock();
  }, []);
  return useSyncExternalStore(subscribe, () => loaded);
}

/** On, off, or not known yet (undefined) for this person. Nobody signed in is never locked. */
export function useAppLockOn(userId: string | null): boolean | undefined {
  const known = useAppLockLoaded();
  const set = useSyncExternalStore(subscribe, () => users);
  if (!userId) return false;
  return known ? set.has(userId) : undefined;
}

/** This person just proved who they are: the check passed, they signed in, or they turned the lock on. */
export function markProven(userId: string | null): void {
  if (provenFor === userId) return;
  provenFor = userId;
  emit();
}

/** Who may see the screens without being asked again, until the app next locks. */
export function useProvenFor(): string | null {
  return useSyncExternalStore(subscribe, () => provenFor);
}

/** Back in front after `leftAt` (when it went to the background): locked again once it was away long enough. */
export function lockOnReturn(leftAt: number | null, now: number): boolean {
  return leftAt !== null && now - leftAt >= LOCK_AFTER_MS;
}

/** Whether this phone can ask at all: Face ID, Touch ID or at least a passcode. */
export async function canLock(): Promise<boolean> {
  try {
    return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

export type Proof = 'ok' | 'cancelled' | 'failed' | 'impossible';

/**
 * The phone's own check — Face ID, falling back to the passcode, as iOS offers
 * it. 'impossible': the phone can no longer ask (the passcode was turned off
 * since — which itself took the passcode), so the lock cannot be kept.
 */
export async function proveOwner(promptMessage: string, cancelLabel: string): Promise<Proof> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel });
    if (result.success) return 'ok';
    if (['not_enrolled', 'passcode_not_set', 'not_available'].includes(result.error)) return 'impossible';
    if (['user_cancel', 'app_cancel', 'system_cancel', 'user_fallback'].includes(result.error)) return 'cancelled';
    return 'failed';
  } catch {
    return 'failed';
  }
}

/** For tests: forget what was read. */
export function resetAppLockForTests() {
  users = new Set();
  provenFor = null;
  loaded = false;
  loading = null;
}
