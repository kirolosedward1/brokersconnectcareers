import { NEW_PASSWORD_MIN } from '@/lib/auth/password';

/** The website's rule for a new password (password.ts), and the one the keyboard's suggestion follows. */
export const PASSWORD_MIN = NEW_PASSWORD_MIN;
export const PASSWORD_RULES = `minlength: ${PASSWORD_MIN};`;

/**
 * What can be said about a new password while it is typed, without
 * interrupting: too short once anything is typed, and a confirmation that
 * differs once it is as long as the first — not at its first letter, which
 * cannot match yet. The form still checks both when it is sent.
 */
export function livePasswordChecks(password: string, confirm: string): { short: boolean; mismatch: boolean } {
  return {
    short: password.length > 0 && password.length < PASSWORD_MIN,
    mismatch: confirm.length > 0 && confirm.length >= password.length && confirm !== password,
  };
}
