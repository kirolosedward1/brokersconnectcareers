import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Nightly: flip active -> expired for anything past its 30-day window, and drop
 * featured placements whose 14 days are up. No permanently open ghost listings.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without a configured
 * secret the endpoint refuses outright rather than running unauthenticated.
 */
export async function GET(request: NextRequest) {
  const secret = env.cronSecret;
  const authorization = request.headers.get('authorization');

  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data, error } = await createAdminClient().rpc('expire_stale_jobs');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ expired: data ?? 0, at: new Date().toISOString() });
}
