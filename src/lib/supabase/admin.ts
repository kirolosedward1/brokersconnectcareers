import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only for work that RLS cannot express and that has already been authorised
 * in application code: the nightly expiry cron, admin moderation actions, and
 * minting a signed CV URL for an employer who owns the job in question.
 * Never import this into a Client Component.
 */
export function createAdminClient() {
  return createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
