/**
 * Whether an admin must use a second factor before an admin surface opens.
 *
 * Off unless `ADMIN_MFA_REQUIRED=true`. Unset, `false`, and any other value
 * mean off, in every environment. Turning the requirement back on is that
 * one variable. The website's `requireAdmin`, the email previews, and the
 * app (this flag, published on `/api/mobile/v1/config`) all read it.
 *
 * An admin who has already enrolled is still sent to the challenge, and the
 * database still refuses that session at aal1 (migration 311), whatever this
 * says. The role check (`isAdmin` / `assertAdmin` / `admin_begin`) is separate
 * and always runs.
 */
export function adminMfaRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ADMIN_MFA_REQUIRED === 'true';
}

/**
 * Whether this caller may pass an admin gate that is not the database.
 *
 * The role is always required. The authenticator is required only when the
 * deployment turned the switch on — an admin who has not entered a code this
 * session is turned away then, and let through otherwise.
 */
export function adminCleared(isAdminRole: boolean, owesSecondFactor: boolean, mfaRequired: boolean): boolean {
  if (!isAdminRole) return false;
  return !(mfaRequired && owesSecondFactor);
}
