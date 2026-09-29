import {
  MULTIPART_ACTIONS,
  type MobileActionInput,
  type MobileActionName,
  type MobileActionOutput,
} from '@/lib/mobile-api/contract';
import { env } from './env';
import { supabase } from './supabase';

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

async function currentToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function send(path: string, init: RequestInit, withToken: boolean): Promise<Response> {
  const attempt = (token: string | null) =>
    fetch(`${env.siteUrl}${path}`, {
      ...init,
      credentials: 'omit',
      headers: {
        accept: 'application/json',
        ...(init.headers as Record<string, string> | undefined),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });

  let response: Response;
  try {
    const token = withToken ? await currentToken() : null;
    response = await attempt(token);

    if (response.status === 401 && token) {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
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
