import { createClient, type EmailOtpType, type Session } from '@supabase/supabase-js';
import { env } from '~/lib/env';

/**
 * An email link's token, traded for its session without making that session
 * this phone's: a client of its own that keeps nothing, so the account a link
 * belongs to is known before anyone is signed in or out on its strength.
 *
 * Supabase finds the account by the token alone — it never looks at who is
 * signed in — and its verify answers with that account's session. Taken
 * straight into the app's client (what verifyOtp there does), a link someone
 * else sent, for an account of theirs, signed the person holding the phone
 * into it without a word: their CV, their applications, their phone's pushes,
 * all going to the sender. Held here, the session is the app's only once it
 * is known to be the one signed in already, or nobody is, or the person has
 * said to switch (auth/confirm.tsx).
 */
let checker: ReturnType<typeof createClient> | null = null;

function client() {
  checker ??= createClient(env.supabaseUrl, env.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'bc-link-check' },
  });
  return checker;
}

export type LinkCheck =
  | { kind: 'session'; session: Session }
  /** Taken, with nobody to sign in: the first of an email change's two links. */
  | { kind: 'accepted' }
  | { kind: 'error'; error: unknown };

export async function checkLink(type: EmailOtpType, tokenHash: string): Promise<LinkCheck> {
  try {
    const { data, error } = await client().auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return { kind: 'error', error };
    return data.session ? { kind: 'session', session: data.session } : { kind: 'accepted' };
  } catch (error) {
    return { kind: 'error', error };
  }
}
