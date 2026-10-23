/**
 * A confirmation opened on a different device.
 *
 * Sign-up uses PKCE. The code verifier stays in the browser that asked for
 * the email, so exchangeCodeForSession on a phone — or any other browser —
 * fails with the verifier missing. GoTrue has already confirmed the address
 * by then: the verify step runs before it redirects back with the code. That
 * is not an expired link, and it must not read as one.
 *
 * The current templates do not use that code. They send a token hash to
 * /auth/confirm (supabase/templates/confirmation.html), and verifyOtp spends
 * it on whatever device opens it. `signup` is GoTrue's name for that mail;
 * the template's own type is `email`, which verifyOtp uses for the same
 * confirmation, and its next is /onboarding. A magic link is also `email`,
 * but it does not land on onboarding.
 */

export type AuthLinkError = { message?: string; code?: string; name?: string };

/** GoTrue and supabase-js both say it this way. The code is the stable one. */
export function isMissingCodeVerifier(error: AuthLinkError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'pkce_code_verifier_not_found') return true;
  if (error.name === 'AuthPKCECodeVerifierMissingError') return true;
  return /code verifier/i.test(error.message ?? '');
}

function isPasswordReset(type: string | null | undefined, next: string | null | undefined): boolean {
  if (type === 'recovery') return true;
  if (!next) return false;
  return next === '/sign-in/new-password' || next.startsWith('/sign-in/new-password?');
}

/**
 * A sign-up confirmation, rather than a magic link, a reset, or an OAuth
 * return. `confirmed=1` is what the sign-up form puts in the callback's next.
 */
export function isSignupConfirmation(type: string | null | undefined, next: string | null | undefined): boolean {
  if (type === 'signup') return true;
  if (next && /(?:^|[?&])confirmed=1(?:&|$)/.test(next)) return true;
  if (type === 'email' && next && (next === '/onboarding' || next.startsWith('/onboarding?'))) return true;
  return false;
}

export type LinkFailure = 'confirmed' | 'exchange_failed' | 'link_expired';

/**
 * Where a failed link goes, or null when there was no failure.
 *
 * A code with nowhere else to go is the confirmation the allow-list sent back
 * without its `next`: the verifier is missing and the address is confirmed.
 * A password reset we can still recognise keeps the existing error — that
 * link did not confirm an address. An expired or invalid token does too.
 *
 * A token hash only gets the confirmed notice for a sign-up. A magic link or
 * a reset that fails is still the expired error.
 */
export function linkFailureRedirect(input: {
  flow: 'code' | 'token_hash';
  error: AuthLinkError | null | undefined;
  type?: string | null;
  next?: string | null;
}): LinkFailure | null {
  if (!input.error) return null;
  if (!isMissingCodeVerifier(input.error)) {
    return input.flow === 'code' ? 'exchange_failed' : 'link_expired';
  }
  if (input.flow === 'code') {
    if (isPasswordReset(input.type, input.next)) return 'exchange_failed';
    if (isSignupConfirmation(input.type, input.next) || !input.next) return 'confirmed';
    return 'exchange_failed';
  }
  return isSignupConfirmation(input.type, input.next) ? 'confirmed' : 'link_expired';
}
