import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { logFailure } from '@/lib/observe';
import { challenge, readBearer, tokenRefused } from './bearer';
import { runAsMobile, type MobileSession } from './context';

/**
 * The doors of /api/mobile/v1, and the two routes the website shares with the
 * app (a CV behind a signed link, the account export).
 *
 * Every answer is `no-store`: these are one person's data or one person's
 * action. The public list endpoints set their own caching and do not come
 * through here.
 */

const PRIVATE = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } as const;

export function mobileJson(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return NextResponse.json(body, { status: init.status ?? 200, headers: { ...PRIVATE, ...init.headers } });
}

export function unauthorized(reason: 'unauthenticated' | 'invalid_token') {
  return mobileJson({ error: reason }, { status: 401, headers: { 'www-authenticate': challenge(reason) } });
}

/**
 * Ask the auth server whether a token is good, once per request.
 *
 * Three answers, kept apart because the app does different things with them:
 * a user (carry on), a token the auth server refused (401 — the app refreshes
 * and retries, and signs out if the refresh is refused too), and an auth
 * server that did not answer (503 — the app keeps its session and says the
 * service is unavailable; signing somebody out because Supabase blinked would
 * be the worst reading of an outage).
 */
async function verify(jwt: string): Promise<{ session: NonNullable<MobileSession> } | { refused: Response }> {
  const verifier = createSupabaseClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
    const { data, error } = await verifier.auth.getUser(jwt);
    if (data?.user && !error) return { session: { jwt, user: data.user } };
    if (tokenRefused(error)) return { refused: unauthorized('invalid_token') };
    logFailure('mobile-api', 'the auth server did not answer a token check', { status: error?.status });
  } catch (error) {
    logFailure('mobile-api', 'the auth server did not answer a token check', {
      detail: error instanceof Error ? error.message : 'unknown',
    });
  }
  return { refused: mobileJson({ error: 'unavailable' }, { status: 503 }) };
}

type RouteHandler<C> = (request: NextRequest, context: C) => Promise<Response>;

/**
 * A mobile route. With a bearer token, the handler runs as that user; without
 * one it runs signed out — and is refused outright unless `optional` says a
 * signed-out caller is welcome. Either way the cookie session is never read.
 */
export function withMobileAuth<C>(
  handler: (request: NextRequest, context: C, session: MobileSession) => Promise<Response>,
  options: { optional?: boolean } = {},
): RouteHandler<C> {
  return async (request, context) => {
    const bearer = readBearer(request.headers.get('authorization'));
    if (bearer.kind === 'malformed') return unauthorized('invalid_token');

    let session: MobileSession = null;
    if (bearer.kind === 'token') {
      const verified = await verify(bearer.token);
      if ('refused' in verified) return verified.refused;
      session = verified.session;
    } else if (!options.optional) {
      return unauthorized('unauthenticated');
    }

    return runAsMobile(session, async () => {
      try {
        return await handler(request, context, session);
      } catch (error) {
        logFailure('mobile-api', 'a mobile route threw', {
          path: request.nextUrl.pathname,
          detail: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
        });
        return mobileJson({ error: 'failed' }, { status: 500 });
      }
    });
  };
}

/**
 * A route the website reaches with its cookie and the app with its token.
 *
 * No Authorization header: exactly the website's route, cookies and all. A
 * header: the app's rules above, and cookies are not consulted. These are GET
 * routes that read on behalf of their caller; none of them changes anything.
 */
export function withOptionalBearer<C>(handler: RouteHandler<C>): RouteHandler<C> {
  return async (request, context) => {
    const bearer = readBearer(request.headers.get('authorization'));
    if (bearer.kind === 'none') return handler(request, context);
    if (bearer.kind === 'malformed') return unauthorized('invalid_token');

    const verified = await verify(bearer.token);
    if ('refused' in verified) return verified.refused;
    return runAsMobile(verified.session, () => handler(request, context));
  };
}

/** True when the caller asked for JSON rather than to be redirected. */
export function wantsJson(request: NextRequest): boolean {
  return (request.headers.get('accept') ?? '').includes('application/json');
}

const JSON_LIMIT = 256 * 1024;
const UPLOAD_LIMIT = 3 * 1024 * 1024;

/**
 * An action's input, read within limits.
 *
 * JSON for everything but an image upload, which is multipart. A declared
 * length over the limit is refused before reading; an undeclared one is
 * counted as it arrives. Route handlers have no body limit of their own — the
 * 3 MB `bodySizeLimit` in next.config.ts binds server actions only.
 */
export async function readActionInput(
  request: NextRequest,
  kind: 'json' | 'multipart',
): Promise<{ value: unknown } | { refused: Response }> {
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  const limit = kind === 'multipart' ? UPLOAD_LIMIT : JSON_LIMIT;

  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limit) {
    return { refused: mobileJson({ error: 'too_large' }, { status: 413 }) };
  }

  if (kind === 'multipart') {
    if (!type.startsWith('multipart/form-data')) {
      return { refused: mobileJson({ error: 'unsupported_media_type' }, { status: 415 }) };
    }
    try {
      return { value: await request.formData() };
    } catch {
      return { refused: mobileJson({ error: 'malformed' }, { status: 400 }) };
    }
  }

  if (!type.startsWith('application/json')) {
    return { refused: mobileJson({ error: 'unsupported_media_type' }, { status: 415 }) };
  }

  const text = await request.text();
  if (text.length > limit) return { refused: mobileJson({ error: 'too_large' }, { status: 413 }) };
  if (text.trim() === '') return { value: undefined };

  try {
    const body = JSON.parse(text) as { input?: unknown } | null;
    return { value: body && typeof body === 'object' ? body.input : undefined };
  } catch {
    return { refused: mobileJson({ error: 'malformed' }, { status: 400 }) };
  }
}

const SHARED = 'public, s-maxage=60, stale-while-revalidate=300';

/**
 * A read whose answer is the same for every caller — the board, the company
 * pages, the browse counts — so the CDN may keep it for a minute.
 *
 * It runs signed out whatever the request carries: a token would not change
 * the answer, and a cached answer must never be one person's. Failures are
 * `no-store`, so an outage is not cached for a minute afterwards.
 */
export function publicRead<C>(handler: (request: NextRequest, context: C) => Promise<unknown>): RouteHandler<C> {
  return (request, context) =>
    runAsMobile(null, async () => {
      try {
        const body = await handler(request, context);
        if (body instanceof Response) return body;
        return NextResponse.json(body, {
          headers: { 'cache-control': SHARED, 'x-content-type-options': 'nosniff' },
        });
      } catch (error) {
        logFailure('mobile-api', 'a public read failed', {
          path: request.nextUrl.pathname,
          detail: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
        });
        return mobileJson({ error: 'unavailable' }, { status: 503 });
      }
    });
}

/** Query parameters in the shape the website's parsers take. */
export function searchParamsOf(request: NextRequest): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const key of new Set(request.nextUrl.searchParams.keys())) {
    const values = request.nextUrl.searchParams.getAll(key);
    params[key] = values.length > 1 ? values : values[0];
  }
  return params;
}
