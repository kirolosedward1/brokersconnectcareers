/**
 * The shortest new password either client accepts — at sign-up, on a reset
 * link and in the account's settings — and the one Supabase Auth is set to
 * (Authentication → Policies → Minimum password length, and
 * supabase/config.toml for the local stack). The forms say it before the
 * server would refuse, in validation.passwordShort, which names the number.
 *
 * Signing in asks no length at all. The minimum was 8, and the server's was
 * lower before that: an account whose password predates this rule still has
 * it, and a wrong password is the server's to answer.
 */
export const NEW_PASSWORD_MIN = 10;
