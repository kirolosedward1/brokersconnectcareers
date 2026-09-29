import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { env } from './env';
import { encryptedSessionStorage } from './session-storage';

/**
 * The one Supabase client in the app.
 *
 * It reads directly — the taxonomies, a person's own applications, saved jobs,
 * notifications, the RPCs behind the dashboards — under the user's JWT, so
 * row-level security answers exactly as it does for the website. Writes do not
 * come through here: they go to /api/mobile/v1 (see api.ts), which runs the
 * website's own server actions.
 *
 * PKCE, because the one redirect flow the app runs (Google, through the system
 * browser) must not put tokens in a URL. The session is stored encrypted
 * (session-storage.ts) and refreshed only while the app is in the foreground,
 * which is what Supabase recommends for React Native.
 */

/** Where supabase-js keeps the session — its own default name, spelled out so the app can look for it. */
export const SESSION_KEY = `sb-${new URL(env.supabaseUrl).hostname.split('.')[0]}-auth-token`;

const DATA_PATHS = ['/rest/v1/', '/storage/v1/'];

/**
 * Every request the client makes, except a read of the database or of
 * storage that would go out as nobody while somebody is signed in here; and
 * with a refresh the auth service asks to wait for read as no answer.
 *
 * supabase-js sends the publishable key in place of the person's token
 * whenever it has no usable session — a refresh that failed (offline, the
 * auth service down, the pause it takes after a failure) — and row-level
 * security then answers as it would a stranger: no profile, which sent an
 * established account to onboarding, and no applications, no saved jobs,
 * nothing, as though that were the truth. Refused here as a request with no
 * answer, it reads as offline and is tried again once the session is back.
 *
 * The auth service answers 429 to a refresh when an address has asked too
 * often — and Egypt's carriers put many phones behind one address. auth-js
 * takes any such answer as the session refused and, once the access token has
 * run out (every launch after an hour away), deletes it: signed out for being
 * one of many. Then, as no answer, the session is kept and the refresh tried
 * again, as when offline. While the access token still works, auth-js keeps
 * the session itself, and the 429 is passed on to be said as it is.
 */
async function signedInFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = url.startsWith(env.supabaseUrl) ? url.slice(env.supabaseUrl.length) : '';
  if (
    DATA_PATHS.some((prefix) => path.startsWith(prefix)) &&
    new Headers(init?.headers).get('authorization') === `Bearer ${env.supabaseKey}` &&
    (await encryptedSessionStorage.getItem(SESSION_KEY))
  ) {
    throw new TypeError('Network request failed: the session could not be refreshed');
  }
  const response = await fetch(input, init);
  if (
    response.status === 429 &&
    path.startsWith('/auth/v1/token?') &&
    path.includes('grant_type=refresh_token') &&
    accessTokenExpired(await encryptedSessionStorage.getItem(SESSION_KEY))
  ) {
    throw new TypeError('Network request failed: the auth service asked to wait');
  }
  return response;
}

function accessTokenExpired(stored: string | null): boolean {
  try {
    const expiresAt = (JSON.parse(stored ?? 'null') as { expires_at?: number } | null)?.expires_at;
    return typeof expiresAt === 'number' && expiresAt * 1000 <= Date.now();
  } catch {
    return false;
  }
}

export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseKey, {
  global: { fetch: signedInFetch },
  /*
    Reads give up after 20 s, and are not retried here: TanStack Query already
    tries a failed read three times, and postgrest-js's own three retries (1, 2
    and 4 s apart) inside each of those kept an offline screen spinning for
    about 24 s before it said anything.
  */
  db: { timeout: 20_000, retry: false },
  auth: {
    storage: encryptedSessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
