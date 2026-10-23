import { Platform } from 'react-native';
import { isAuthRetryableFetchError, type AuthError, type User } from '@supabase/supabase-js';
import { forgetAppleSignIn } from '~/features/auth/apple-credential';
import { forgetOnboardingIntent } from '~/features/auth/kept-intent';
import { appleAuthorizationCode } from '~/features/auth/providers';
import { signOutHere } from '~/features/push/device';
import { callAction } from '~/lib/api';
import { forgetPerson } from '~/lib/local-list';
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
  // No answer — a connection dropped, the half minute ran out — is not "not
  // deleted": the website deletes the account, then answers. Asked whether it
  // still knows this account, the auth server settles it.
  const gone = result ? false : await accountGone();
  if (gone) {
    // What the person kept on this phone goes only when the auth server named
    // the account as no more; a token it merely refused says too little to
    // throw away notes nobody could get back.
    await forgetHere(user, gone === 'certain');
    return null;
  }
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
  await forgetHere(user, true);
  return null;
}

/**
 * Signed out as the Account tab signs out (signOutHere: a sign-out auth-js
 * answers with an error still leaves nobody signed in), the Apple ID they
 * signed in with here and where onboarding was taking them let go, and —
 * `everything` — what the phone kept for the person: their lists, reminders
 * and push choices.
 */
async function forgetHere(user: User | null | undefined, everything: boolean): Promise<void> {
  await signOutHere();
  await Promise.all([forgetAppleSignIn(), forgetOnboardingIntent()]);
  if (everything && user?.id) await forgetPerson(user.id).catch(() => {});
}

/**
 * Whether the auth server says this session's account is no more: refused
 * outright (401, 403, 404, user_not_found), as it answers for a user deleted
 * from under a token. No answer, or the account read back, is not gone.
 * 'certain' when it named the account as missing (user_not_found, 404);
 * 'likely' when it only refused the token, which an expired or unverifiable
 * one is refused with too.
 */
async function accountGone(): Promise<'certain' | 'likely' | false> {
  const { data, error } = await supabase.auth
    .getUser()
    .catch((failure: unknown) => ({ data: { user: null }, error: failure as AuthError }));
  if (data.user || !error || isAuthRetryableFetchError(error)) return false;
  if (error.code === 'user_not_found' || error.status === 404) return 'certain';
  return error.status === 401 || error.status === 403 || error.code === 'session_not_found' ? 'likely' : false;
}
