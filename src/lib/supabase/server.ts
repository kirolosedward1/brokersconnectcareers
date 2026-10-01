import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { SESSION_COOKIE_OPTIONS } from './cookie-options';
import { env } from '@/lib/env';
import { createMobileClient, mobileScope } from '@/lib/mobile-api/context';
import type { Database } from './database.types';

/**
 * Request-scoped client that carries the signed-in user's JWT, so every query
 * runs under RLS. This is the default for anything user-facing.
 *
 * Inside a mobile API route the JWT is the app's bearer token, verified at the
 * door, and cookies are not read at all — see src/lib/mobile-api/context.ts.
 */
export async function createClient() {
  const mobile = mobileScope();
  if (mobile) {
    return createMobileClient(mobile.session) as unknown as ReturnType<
      typeof createServerClient<Database>
    >;
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session, so this is safe to swallow.
        }
      },
    },
    cookieOptions: SESSION_COOKIE_OPTIONS,
  });
}
