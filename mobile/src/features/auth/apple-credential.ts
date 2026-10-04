import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';

/**
 * Who signed in on this phone with Sign in with Apple, and as which Apple ID
 * (Apple's `user`, the identity token's `sub`). iOS answers for an Apple ID
 * whether it still lets this app use it — the person can turn it off in
 * Settings (Apple ID → Sign in with Apple) — and a session made with it is
 * ended here when it does not (AppleCredentialWatch). Only a session made
 * with Apple on this phone is asked about: an account that also has an Apple
 * ID, signed in with its password, is not.
 */
const KEY = 'auth:apple-sign-in';

export async function rememberAppleSignIn(userId: string, appleUser: string): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify({ userId, appleUser })).catch(() => {});
}

export async function forgetAppleSignIn(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {});
}

/**
 * Whether Apple no longer lets this app use the Apple ID this person signed
 * in with here. Revoked only: an Apple ID iOS does not know (signed out of
 * iCloud, another Apple ID on the phone) or a question that cannot be asked
 * says nothing about the account, and ends nothing.
 */
export async function appleSignInRevoked(userId: string): Promise<boolean> {
  const kept = await AsyncStorage.getItem(KEY).catch(() => null);
  if (!kept) return false;
  let record: { userId?: unknown; appleUser?: unknown };
  try {
    record = JSON.parse(kept) as typeof record;
  } catch {
    return false;
  }
  if (record.userId !== userId || typeof record.appleUser !== 'string') return false;
  const state = await AppleAuthentication.getCredentialStateAsync(record.appleUser).catch(() => null);
  return state === AppleAuthentication.AppleAuthenticationCredentialState.REVOKED;
}
