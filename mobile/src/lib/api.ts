import {
  MULTIPART_ACTIONS,
  type MobileActionInput,
  type MobileActionName,
  type MobileActionOutput,
} from '@/lib/mobile-api/contract';
import { isAuthApiError, isAuthRetryableFetchError, isAuthSessionMissingError } from '@supabase/supabase-js';
import { env } from './env';
import { encryptedSessionStorage } from './session-storage';
import { SESSION_KEY, supabase } from './supabase';

/**
 * The app's side of /api/mobile/v1 (see src/lib/mobile-api/contract.ts on the
 * website for what each action takes and answers).
 *
 * Writes: `callAction(name, input)` returns the server action's own result —
 * `{ ok: true, data }` or `{ ok: false, error }` — exactly as the website's
 * form would get it. A thrown ApiError means the request never reached the
 * action: offline, signed out, the service down.
 *
 * The token: the current access token rides every call. A 401 means it was
 * refused; the session is refreshed once and the call repeated, and if the
 * refresh is refused too the person is signed out on this device. A 503 is
 * the auth service not answering — the session is kept, and the call fails.
 *
 * Never cookies (`credentials: 'omit'`): the server ignores them on these
 * routes, and React Native would otherwise keep any it was sent.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
  }
}

/**
 * Whether a failed call is known never to have reached the action: the route
 * turned it away at the door (an action's own answer is always a 200, so a 4xx
 * is the door's). Offline and 5xx say nothing either way — the action may have
 * run and only its answer been lost, so whatever it was given (an uploaded
 * file) may already be recorded.
 */
export function refusedAtTheDoor(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

/**
 * A call or a read that got no answer at all — offline, a dropped connection,
 * a timeout — as opposed to one the server answered with a refusal. The app's
 * own calls say it with status 0; supabase-js reports a fetch that never
 * answered as an error with no code whose message names the fetch's failure.
 */
export function noAnswer(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 0;
  const failure = error as { message?: unknown; code?: unknown } | null;
  return (
    typeof failure?.message === 'string' &&
    !failure.code &&
    /^(TypeError|AbortError|TimeoutError|FetchError)\b/.test(failure.message)
  );
}

/** The auth server said no to a refresh: the session cannot be continued. */
function refreshRefused(error: unknown): boolean {
  if (!error) return true;
  if (isAuthSessionMissingError(error)) return true;
  return isAuthApiError(error) && [400, 401, 403].includes(error.status ?? 0);
}

async function currentToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.access_token;
  // None while a session is still stored on the phone: its refresh failed
  // without being refused (offline, the auth service down or asking to
  // wait). Sent without a token, the call was answered as a stranger's —
  // "unauthenticated", the directory as nobody may see it — so it is said
  // as no answer, as the database's reads are (supabase.ts), and tried again.
  if (await encryptedSessionStorage.getItem(SESSION_KEY)) throw new ApiError(0, 'offline');
  return null;
}

/**
 * How long a call may go without an answer before it counts as none. Without
 * one, a stalled connection kept a button spinning, and the notification that
 * was being opened blocking every other, until iOS gave up on its own. Longer
 * for a photo sent through the website.
 */
const TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 90_000;

/** What `pending` answers, or no answer once `ms` have passed. */
function within<T>(pending: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const late = setTimeout(() => reject(new ApiError(0, 'offline')), ms);
    pending.then(
      (value) => {
        clearTimeout(late);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(late);
        reject(error);
      },
    );
  });
}

async function send(path: string, init: RequestInit, withToken: boolean): Promise<Response> {
  // One time limit for the whole call, the token's refresh included: a refresh
  // that hung kept a write waiting before its own time had even started.
  const deadline = Date.now() + (init.body instanceof FormData ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS);
  const left = () => Math.max(deadline - Date.now(), 1_000);
  const attempt = (token: string | null) =>
    fetch(`${env.siteUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(left()),
      credentials: 'omit',
      headers: {
        accept: 'application/json',
        ...(init.headers as Record<string, string> | undefined),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });

  let response: Response;
  try {
    const token = withToken ? await within(currentToken(), left()) : null;
    response = await attempt(token);

    if (response.status === 401 && token) {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        // Only a refusal ends the session here: the refresh token is spent or
        // revoked, or the session is gone. No answer, a rate limit (carriers
        // put many phones behind one address) or a failing auth service is
        // not one — signing out over it wiped every screen, half-typed forms
        // included.
        if (!refreshRefused(error)) {
          throw isAuthRetryableFetchError(error)
            ? new ApiError(0, 'offline')
            : new ApiError(error?.status === 429 ? 429 : 503, error?.status === 429 ? 'rate_limited' : 'unavailable');
        }
        await supabase.auth.signOut({ scope: 'local' });
        throw new ApiError(401, 'unauthenticated');
      }
      response = await attempt(data.session.access_token);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'offline');
  }
  return response;
}

async function failure(response: Response): Promise<ApiError> {
  let body: { error?: unknown; retryAfterSeconds?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Not JSON — an edge page, a proxy. The status says enough.
  }
  return new ApiError(
    response.status,
    typeof body.error === 'string' ? body.error : 'failed',
    typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : undefined,
  );
}

/** Run one of the website's server actions as the signed-in user (or signed out, for the four that allow it). */
export async function callAction<N extends MobileActionName>(
  name: N,
  ...[input]: MobileActionInput<N> extends undefined ? [] : [MobileActionInput<N>]
): Promise<MobileActionOutput<N>> {
  const multipart = (MULTIPART_ACTIONS as readonly string[]).includes(name);
  const response = await send(
    `/api/mobile/v1/actions/${name}`,
    multipart
      ? { method: 'POST', body: input as FormData }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: input ?? null }),
        },
    true,
  );
  if (response.status !== 200) throw await failure(response);
  return (await response.json()) as MobileActionOutput<N>;
}

/**
 * A GET from /api/mobile/v1 (or a shared route like /api/cv/<id>).
 *
 * The board, the company pages and the browse counts are the same for every
 * reader and cached at the edge, so they are fetched without the token
 * (`signedIn: false`); anything about the reader sends it.
 */
export async function getJson<T>(path: string, options: { signedIn?: boolean } = {}): Promise<T> {
  const response = await send(path, { method: 'GET' }, options.signedIn ?? false);
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}
