import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient as createSupabaseClient, type User } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Who a mobile request is, for the length of that request.
 *
 * The app calls the same server actions the website runs, through
 * /api/mobile/v1. Those actions ask `createClient()` for "the client of whoever
 * is calling", and on the website that is the cookie session. For the app it
 * is the bearer token the route already verified — so a mobile route runs its
 * handler inside this scope, and `createClient()` looks here first.
 *
 * Inside the scope the cookie client is never built, whatever the request
 * carries. That is the property that matters: a mobile route answers JSON to
 * anybody who can send a request, and a browser sends its cookies along with
 * a cross-site form post. A route that fell back to the cookie session would
 * let any page on the internet delete the account of whoever visited it. With
 * no token, the scope holds `null` and the client is the anonymous one.
 */

export type MobileSession = { jwt: string; user: User } | null;

type Scope = { session: MobileSession };

const scope = new AsyncLocalStorage<Scope>();

export function runAsMobile<T>(session: MobileSession, work: () => T): T {
  return scope.run({ session }, work);
}

/** Inside a mobile route, its scope; outside one, undefined. */
export function mobileScope(): Scope | undefined {
  return scope.getStore();
}

/**
 * The Supabase client for a mobile request.
 *
 * With a session: the user's JWT on every PostgREST, RPC and Storage call, so
 * row-level security sees exactly the user the website's cookie client would.
 * `auth.getUser()` with no argument answers with the user verified at the
 * door instead of asking the auth server again — several actions call it two
 * or three times per request, and a token cannot change mid-request.
 *
 * Without one: the anonymous client, as a signed-out visitor.
 *
 * `flowType: 'implicit'` because this client can start email flows (password
 * reset, resend confirmation) and keeps nothing: a PKCE verifier stored here
 * would be discarded with the request, and the link in the email could never
 * be redeemed anywhere.
 */
export function createMobileClient(session: MobileSession) {
  const client = createSupabaseClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'implicit',
    },
    ...(session ? { global: { headers: { Authorization: `Bearer ${session.jwt}` } } } : {}),
  });

  if (session) {
    const ask = client.auth.getUser.bind(client.auth);
    client.auth.getUser = ((jwt?: string) =>
      jwt
        ? ask(jwt)
        : Promise.resolve({ data: { user: session.user }, error: null })) as typeof client.auth.getUser;
  }

  return client;
}
