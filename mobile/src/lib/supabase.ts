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
export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseKey, {
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
