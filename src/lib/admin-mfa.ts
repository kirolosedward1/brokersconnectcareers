/**
 * Whether an admin who has not enrolled a second factor must set one up
 * before the console opens.
 *
 * Off unless `ADMIN_MFA_REQUIRED=true`. Unset, `false`, and any other value
 * mean off, in every environment, so an admin is not asked to enrol. Set
 * `true` to require enrolment again. The website's `requireAdmin` and the
 * app's door (this flag, published on `/api/mobile/v1/config`) both read it.
 *
 * An admin who has already enrolled is still sent to the challenge, and the
 * database still refuses that session at aal1 (migration 311), whatever this
 * says. The role check (`isAdmin` / `assertAdmin` / `admin_begin`) is separate
 * and always runs. No migration is part of turning the requirement off.
 */
export function adminMfaRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ADMIN_MFA_REQUIRED === 'true';
}
