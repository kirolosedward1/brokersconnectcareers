/**
 * GoTrue's errors, as the product's own words — a key in the catalogue.
 *
 * Out of the website's auth form so the iOS app says the same sentence for
 * the same refusal. Pure: the caller turns the key into words with its own
 * translator.
 */

/**
 * Supabase speaks English, and this page does not.
 *
 * Every auth failure was reaching the reader as whatever string GoTrue
 * returned — "Invalid login credentials" on an otherwise Arabic sign-in form.
 * The same class of bug as an untranslated status enum, and worse placed: it
 * lands on the one screen where somebody is already unsure whether they did
 * something wrong.
 *
 * GoTrue's code first, its prose as the fallback. Anything unrecognised falls
 * through to the generic line rather than to English — a reader is better
 * served by "something went wrong" in their own language than by a precise
 * sentence in one they may not read.
 */
export type AuthErrorKey = { namespace: 'auth' | 'validation'; key: string };

/**
 * GoTrue's own error codes, which are stable across versions and do not change
 * with the server's language. Matched first.
 *
 * The message regexes below were the only thing here, and they are English
 * prose from another team's codebase — a rewording upstream silently turns a
 * precise message into "something went wrong". Live testing found one already:
 * a rejected domain answers `Email address "x@y" is invalid`, which matches
 * neither /unable to validate email/ nor /invalid format/, so a mistyped
 * address produced the generic error instead of "check your email address".
 */
export const AUTH_ERROR_CODES: Record<string, AuthErrorKey> = {
  invalid_credentials: { namespace: 'auth', key: 'errBadCredentials' },
  user_already_exists: { namespace: 'auth', key: 'errEmailTaken' },
  email_exists: { namespace: 'auth', key: 'errEmailTaken' },
  email_not_confirmed: { namespace: 'auth', key: 'errEmailUnconfirmed' },
  over_request_rate_limit: { namespace: 'auth', key: 'errTooMany' },
  over_email_send_rate_limit: { namespace: 'auth', key: 'errTooMany' },
  email_address_invalid: { namespace: 'validation', key: 'invalidEmail' },
  validation_failed: { namespace: 'validation', key: 'invalidEmail' },
  weak_password: { namespace: 'validation', key: 'passwordShort' },
  // CAPTCHA on in Supabase Auth (SUPABASE_SETTINGS.md) and a token missing,
  // spent or refused: the form loads the check again; this says to retry.
  captcha_failed: { namespace: 'auth', key: 'errCaptcha' },
};

/** Kept as the fallback, for older servers and errors that carry no code. */
export const AUTH_ERRORS: { match: RegExp; namespace: 'auth' | 'validation'; key: string }[] = [
  { match: /invalid login credentials/i, namespace: 'auth', key: 'errBadCredentials' },
  { match: /already registered|already been registered|user already exists/i, namespace: 'auth', key: 'errEmailTaken' },
  { match: /email not confirmed|confirm your email/i, namespace: 'auth', key: 'errEmailUnconfirmed' },
  { match: /for security purposes|rate limit|too many requests/i, namespace: 'auth', key: 'errTooMany' },
  { match: /unable to validate email|invalid format|address .* is invalid/i, namespace: 'validation', key: 'invalidEmail' },
  { match: /password should be at least/i, namespace: 'validation', key: 'passwordShort' },
  { match: /captcha/i, namespace: 'auth', key: 'errCaptcha' },
];

/**
 * The catalogue key for an auth error, or null for one nobody has mapped —
 * which the caller shows as the generic line, never as GoTrue's English.
 * The stable `code` is read first and the prose only when there is none.
 */
export function knownAuthError(error: { message: string; code?: string } | string): AuthErrorKey | null {
  const message = typeof error === 'string' ? error : error.message;
  const code = typeof error === 'string' ? undefined : error.code;
  return (code ? AUTH_ERROR_CODES[code] : undefined) ?? AUTH_ERRORS.find((entry) => entry.match.test(message)) ?? null;
}
