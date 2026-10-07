/**
 * The admin functions raise short, stable words — `invalid_transition`,
 * `reason_required` — and this turns a PostgREST error into one of them, so
 * the console can say a sentence instead of printing the database's.
 *
 * Its own file with no imports, so both the server actions and the client
 * components that render the sentence can reach the same list.
 */
export const ADMIN_ERROR_CODES = [
  'forbidden',
  'invalid',
  'not_found',
  'no_change',
  'invalid_action',
  'invalid_transition',
  'stale_version',
  'reason_required',
  'reason_too_long',
  'post_cap',
  'no_credits',
  'company_suspended',
  'taxonomy_in_use',
  'taxonomy_slug_is_permanent',
  'invalid_slug',
  'invalid_name',
  'invalid_governorate',
  'slug_taken',
  'unavailable',
  'not_migrated',
  'unknown',
] as const;

export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[number];

type PostgrestLikeError = { message?: string; code?: string; details?: string | null };

/** Database words that differ from the console's. */
const ALIASES: Record<string, AdminErrorCode> = {
  unverified_company_post_cap: 'post_cap',
  insufficient_post_credits: 'no_credits',
  'an admin cannot change their own approval': 'forbidden',
  'no such account, or it belongs to an admin': 'not_found',
};

export function adminErrorCode(error: PostgrestLikeError): AdminErrorCode {
  const message = (error.message ?? '').trim();

  // A function the deployed database does not have yet: the code reached
  // production before migrations 316–319. Said plainly, because "unknown error"
  // on every button would send somebody looking in the wrong place.
  if (error.code === 'PGRST202' || error.code === '42883' || error.code === '42703') {
    return 'not_migrated';
  }
  if (error.code === '23505') return 'slug_taken';
  if (error.code === '42501') return 'forbidden';

  for (const [needle, code] of Object.entries(ALIASES)) {
    if (message.includes(needle)) return code;
  }

  const word = message.split(/\s/)[0];
  return (ADMIN_ERROR_CODES as readonly string[]).includes(word) ? (word as AdminErrorCode) : 'unknown';
}

export function isAdminErrorCode(value: string | undefined): value is AdminErrorCode {
  return (ADMIN_ERROR_CODES as readonly string[]).includes(value ?? '');
}
