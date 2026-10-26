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

/**
 * The link's check has the same limit as every auth request in the app's own
 * client (lib/supabase.ts): this client does not go through that fetch, and
 * auth-js sets no limit of its own, so a stalled connection left the confirm
 * screen on "verifying" for good. Aborted, auth-js answers with a retryable
 * fetch error and the screen offers to try again.
 */
const LINK_CHECK_TIMEOUT_MS = 20_000;

async function boundedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (init?.signal) return fetch(input, init);
  const controller = new AbortController();
  const late = setTimeout(() => controller.abort(), LINK_CHECK_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(late);
  }
}

function client() {
  checker ??= createClient(env.supabaseUrl, env.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'bc-link-check' },
    global: { fetch: boundedFetch },
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
