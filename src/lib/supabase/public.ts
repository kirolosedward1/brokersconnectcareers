import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Anon client with no cookie access, for data that is world-readable and the
 * same for every visitor — the taxonomies, mainly.
 *
 * Because it never touches cookies, its results can be wrapped in
 * `unstable_cache`, which a cookie-bound client cannot be.
 */
export function createPublicClient() {
  return createSupabaseClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
