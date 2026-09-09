import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { notifyJobExpiry } from '@/lib/email/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Nightly: flip active -> expired for anything past its 30-day window, drop
 * featured placements whose 14 days are up, and tell the employers.
 *
 * A listing that expires silently is the worst version of this: the applicants
 * simply stop, the employer assumes the market went quiet, and the one action
 * that would fix it — reposting — is the one nobody thinks to take. So two
 * messages, both bounded:
 *
 *   three days out — while there is still time to renew or hire
 *   the morning after — with the count of who did apply, and a way back
 *
 * Neither can repeat. The dedupe key carries the listing's expires_at, so a
 * renewed listing that expires again is a new message and a re-run of this
 * cron on the same night is not.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without a configured
 * secret the endpoint refuses outright rather than running unauthenticated.
 */

/** How much warning is useful: long enough to act, short enough to be urgent. */
const WARN_DAYS = 3;

export async function GET(request: NextRequest) {
  const secret = env.cronSecret;
  const authorization = request.headers.get('authorization');

  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data, error } = await admin.rpc('expire_stale_jobs');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const day = 86_400_000;

  // Just expired: whatever the call above moved, plus anything that expired
  // since the previous nightly run. Asked as a window rather than taken from
  // expire_stale_jobs()'s return value, which is a count and names no ids.
  const justExpired = await admin
    .from('jobs')
    .select('id')
    .eq('status', 'expired')
    .gte('expires_at', new Date(now - day).toISOString())
    .lte('expires_at', new Date(now).toISOString())
    .limit(200);

  // Expiring: a one-day window WARN_DAYS out, so each listing falls into it on
  // exactly one nightly run.
  const expiringSoon = await admin
    .from('jobs')
    .select('id')
    .eq('status', 'active')
    .gte('expires_at', new Date(now + (WARN_DAYS - 1) * day).toISOString())
    .lte('expires_at', new Date(now + WARN_DAYS * day).toISOString())
    .limit(200);

  const warned = await notifyAll(admin, expiringSoon.data ?? [], 'expiring');
  const closed = await notifyAll(admin, justExpired.data ?? [], 'expired');

  return NextResponse.json({
    expired: data ?? 0,
    warned,
    closed,
    at: new Date().toISOString(),
  });
}

async function notifyAll(
  admin: ReturnType<typeof createAdminClient>,
  jobs: { id: string }[],
  stage: 'expiring' | 'expired',
): Promise<number> {
  let sent = 0;

  for (const job of jobs) {
    // Sequential on purpose. This runs at 1am against a provider with a rate
    // limit, and a hundred parallel sends is how a nightly job earns a 429 for
    // every message after the tenth.
    const { count } = await admin
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', job.id);

    const outcome = await notifyJobExpiry(job.id, stage, count ?? 0);
    if (outcome === 'sent') sent += 1;
  }

  return sent;
}
