/**
 * Whether an admin who has not enrolled a second factor may use the console.
 *
 * Off unless `ADMIN_MFA_REQUIRED=true`. Unset, `false`, and any other value
 * mean off, on every environment, so turning the requirement back on is that
 * one variable. The website's `requireAdmin` and the app's door (the flag
 * this returns, published on `/api/mobile/v1/config`) both read it.
 *
 * An admin who has already enrolled is still sent to the challenge, and the
 * database still refuses that session at aal1 (migration 311), whatever this
 * says. The role check (`isAdmin` / `assertAdmin` / `admin_begin`) is separate
 * and always runs.
 */
export function adminMfaRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ADMIN_MFA_REQUIRED === 'true';
}
