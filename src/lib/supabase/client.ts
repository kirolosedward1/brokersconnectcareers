'use client';

import { createBrowserClient } from '@supabase/ssr';
import { SESSION_COOKIE_OPTIONS } from './cookie-options';
import type { Database } from './database.types';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: SESSION_COOKIE_OPTIONS },
  );
}
