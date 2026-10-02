import { Platform } from 'react-native';
import type { User } from '@supabase/supabase-js';
import { appleAuthorizationCode } from '~/features/auth/providers';
import { callAction } from '~/lib/api';
import { supabase } from '~/lib/supabase';

/** Why an account was not deleted: the website's refusals, Apple not confirming, or anything else. */
export type DeleteRefusal = 'owns_company' | 'under_review' | 'apple' | 'failed';

/** An account made with Sign in with Apple. */
export function signsInWithApple(user: User | null | undefined): boolean {
  return (
    (user?.identities ?? []).some((identity) => identity.provider === 'apple') ||
    ((user?.app_metadata?.providers as string[] | undefined) ?? []).includes('apple')
  );
}

/**
 * Whether deleting this account asks Apple first. Apple's sheet exists on iOS
 * alone: on Android the account goes as the website deletes it, without the
 * code — asking for one there always failed, and the account could not be
 * deleted at all.
 */
export function asksApple(user: User | null | undefined): boolean {
  return signsInWithApple(user) && Platform.OS === 'ios';
}

/**
 * Delete the signed-in account, the way the website does (deleteMyAccount),
 * and clear what is left of it on this phone. One path for every screen that
 * offers it — the Account tab's and onboarding's — so an account made with
 * Apple is always disconnected from Apple first (App Store Guideline
 * 5.1.1(v)): Apple hands over a one-time code the website revokes the app's
 * access with.
 *
 * Null when the account is gone; otherwise why it is not.
 */
export async function deleteAccountHere(user: User | null | undefined): Promise<DeleteRefusal | null> {
  let appleCode: string | undefined;
  if (asksApple(user)) {
    const code = await appleAuthorizationCode();
    if (!code) return 'apple';
    appleCode = code;
  }

  const result = await callAction('deleteMyAccount', appleCode ? { appleAuthorizationCode: appleCode } : {}).catch(
    () => null,
  );
  if (!result?.ok) {
    const code = result && !result.ok ? result.error : null;
    return code === 'owns_company'
      ? 'owns_company'
      : code === 'under_review'
        ? 'under_review'
        : code === 'apple_reauth_required'
          ? 'apple'
          : 'failed';
  }

  // The account no longer exists (its phones went with it); what is left on this phone goes too.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  return null;
}
