import type { NextRequest } from 'next/server';
import { runScheduledJob } from '@/lib/jobs/run';
import { runPushSweep } from '@/lib/push/deliver';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The push sweep (migration 329, src/lib/push).
 *
 * Every minute: send what is due — whatever the after() flush did not get to,
 * the expiry notices held for the morning, the retries backing off — then read
 * Expo's receipts and switch off the phones that no longer have the app, then
 * prune. Called by pg_cron inside the database, only when something is due
 * (so an idle minute is one indexed query and no request), and by Vercel Cron
 * as the second, independent caller; runScheduledJob's lease means the two
 * never run at once. An empty run is one lease call.
 */
export async function GET(request: NextRequest) {
  return runScheduledJob(request, {
    job: 'push',
    maxDurationSeconds: maxDuration,
    work: ({ admin, deadline }) => runPushSweep(admin, deadline),
  });
}
