import AsyncStorage from '@react-native-async-storage/async-storage';
import { intentFromParams, type AuthIntent } from './intent';

/**
 * Onboarding's destination — the listing somebody tapped Apply on before
 * they had an account, the "email confirmed" they came in with — kept on the
 * phone for the account it is for. It lived in onboarding's route alone: iOS
 * ending the app while the person went to copy their number from WhatsApp
 * reopened onboarding bare (the session gate knows only that a profile is
 * missing), and finishing it landed on Home, the listing forgotten.
 */
const KEY = 'bc.onboarding-intent.v1';

export async function keepOnboardingIntent(userId: string, intent: AuthIntent): Promise<void> {
  if (!intent.next && !intent.role && !intent.confirmed) return;
  await AsyncStorage.setItem(KEY, JSON.stringify({ userId, intent })).catch(() => {});
}

/** What onboarding was opened with for this account, read back through a link's own checks; null for anyone else's. */
export async function keptOnboardingIntent(userId: string): Promise<AuthIntent | null> {
  const raw = await AsyncStorage.getItem(KEY).catch(() => null);
  if (!raw) return null;
  try {
    const kept = JSON.parse(raw) as { userId?: unknown; intent?: Record<string, unknown> };
    if (kept.userId !== userId || !kept.intent) return null;
    const { next, role, confirmed } = kept.intent;
    return intentFromParams({
      next: typeof next === 'string' ? next : undefined,
      role: typeof role === 'string' ? role : undefined,
      confirmed: confirmed === true ? '1' : undefined,
    });
  } catch {
    return null;
  }
}

/** Arrived: nothing left to come back to. */
export function forgetOnboardingIntent(): Promise<void> {
  return AsyncStorage.removeItem(KEY).catch(() => {});
}
