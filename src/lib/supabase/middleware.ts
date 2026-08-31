import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
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
export async function updateSession(request: NextRequest, response: NextResponse) {
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
  });

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return { user, response };
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
