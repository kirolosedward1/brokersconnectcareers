import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { SESSION_COOKIE_OPTIONS } from './cookie-options';
import type { User } from '@supabase/supabase-js';
import type { Database } from './database.types';

/**
 * Refreshes the auth cookie and hands back both the user and the response
 * carrying the updated cookies. The response must be the one that is eventually
 * returned, or the refreshed token is lost.
 *
 * Best-effort by design. This runs on *every* request, so anything that throws
 * here takes down the entire site — including the landing page, the blog and
 * the sign-in screen, none of which need a database. Supabase being
 * unconfigured or briefly unreachable should degrade to "nobody is signed in",
 * not to a 500 on every URL.
 */
export async function updateSession(
  request: NextRequest,
  response: NextResponse,
  { checkAdmin = false }: { checkAdmin?: boolean } = {},
): Promise<{ user: User | null; response: NextResponse; isAdmin?: boolean | null; secondFactorDue?: boolean }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // createServerClient throws on empty credentials rather than returning an
  // error, so this has to be checked before constructing it.
  if (!url || !key) {
    console.warn('[middleware] Supabase is not configured; treating the request as anonymous.');
    return { user: null, response };
  }

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
    cookieOptions: SESSION_COOKIE_OPTIONS,
  });

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    /*
      Whether this is an admin, asked only on the console's own paths.

      The console's layout already refuses anybody else, but it runs inside a
      streamed response: the (app) loading boundary has sent a 200 and the
      signed-in user's own shell before the layout's redirect is reached, so
      the refusal arrives as a client-side redirect. Nothing of the console
      renders — the layout throws before its children — but a refusal should be
      a refusal, before anything is rendered at all.

      `null` when the role could not be read: the request continues and the
      layout, which reads the same row, decides. A blip should not lock an
      admin out, and it cannot let anybody else in, because the layout and the
      database both still check.
    */
    let isAdmin: boolean | null | undefined;
    if (checkAdmin && user) {
      const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      isAdmin = error ? null : data?.role === 'admin';
    }

    /*
      An authenticator on the account that this session has not answered:
      what the session's own token proved (aal) against what the account could
      prove (a verified factor). Read from the session, no request.
    */
    let secondFactorDue = false;
    if (user) {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      secondFactorDue = data?.currentLevel === 'aal1' && data.nextLevel === 'aal2';
    }

    return { user, response, isAdmin, secondFactorDue };
  } catch (error) {
    // A network failure reaching the auth server is not a reason to fail the
    // request. Protected routes will redirect to sign-in, which is the right
    // outcome when we cannot establish who this is.
    console.warn(
      '[middleware] could not refresh the session:',
      error instanceof Error ? error.message : error,
    );
    return { user: null, response };
  }
}
