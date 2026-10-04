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
 *
 * No answer is tried again by auth-js seven more times within half a minute,
 * so the wait asked for (Retry-After, or a minute) is kept here: until it has
 * passed, a refresh is answered as no answer without being sent. Sent, each
 * phone behind that one address asked eight times as often as it was told to.
 */
let refreshHeldUntil = 0;

/**
 * A refresh that never answered held every read and write behind it until iOS
 * gave up on the connection, about a minute, and auth-js then waited another
 * before trying again. Ten seconds without an answer counts as none, and
 * auth-js tries again within its own half minute.
 */
const REFRESH_TIMEOUT_MS = 10_000;

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
  const refresh = path.startsWith('/auth/v1/token?') && path.includes('grant_type=refresh_token');
  if (refresh && Date.now() < refreshHeldUntil) {
    throw new TypeError('Network request failed: the auth service asked to wait');
  }
  const response = refresh && !init?.signal ? await withinRefreshTime(input, init) : await fetch(input, init);
  if (refresh && response.status === 429 && accessTokenExpired(await encryptedSessionStorage.getItem(SESSION_KEY))) {
    refreshHeldUntil = Date.now() + waitAskedFor(response.headers.get('retry-after'));
    throw new TypeError('Network request failed: the auth service asked to wait');
  }
  // The auth server refuses a refresh in JSON. A page answering in its place
  // (a firewall's "access denied", a proxy's) is not its answer, and auth-js
  // took that page's 403 for the session refused and signed the person out.
  if (refresh && response.status >= 400 && response.status < 500 && !(response.headers.get('content-type') ?? '').includes('json')) {
    throw new TypeError('Network request failed: the auth service did not answer the refresh');
  }
  return response.ok && SESSION_ANSWERS.test(path) ? onPhoneClock(response) : response;
}

/** The auth server's answers that carry a session: a sign-in or refresh, an email link, a second factor. */
const SESSION_ANSWERS = /^\/auth\/v1\/(token\?|verify|factors\/[^/?]+\/verify)/;

/**
 * When a session runs out, on this phone's clock. The auth server dates it by
 * its own, and auth-js compares that with the phone's: on a phone set an hour
 * wrong by hand, a new session read as run out already (a refresh before
 * every request, using up the allowance of every phone behind the same
 * address) or as good for an hour past its end (every read refused). Its
 * lifetime, counted from now here, is right whatever the phone's clock says.
 */
async function onPhoneClock(response: Response): Promise<Response> {
  if (!(response.headers.get('content-type') ?? '').includes('json')) return response;
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!body || typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify({ ...body, expires_at: Math.round(Date.now() / 1000) + body.expires_in }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** A refresh request, given up on (aborted) after REFRESH_TIMEOUT_MS. */
async function withinRefreshTime(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const late = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(late);
  }
}

/** Retry-After in milliseconds — seconds or a date — between a second and ten minutes; a minute when unsaid. */
function waitAskedFor(header: string | null): number {
  const seconds = header === null || header.trim() === '' ? NaN : Number(header);
  const wait = Number.isFinite(seconds) ? seconds * 1000 : header ? Date.parse(header) - Date.now() : NaN;
  return Math.min(Math.max(Number.isFinite(wait) ? wait : 60_000, 1_000), 600_000);
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
