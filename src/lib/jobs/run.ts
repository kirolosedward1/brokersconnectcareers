import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { configuredValue, env } from '@/lib/env';
import { logEvent, logFailure } from '@/lib/observe';
import { retryDb } from './db';
import { executeJobRun, type JobContext, type JobStats } from './runner-core';

/**
 * Every scheduled job, entered the same way.
 *
 * Before this, each cron route checked the secret, built the admin client and
 * handled its own errors in its own words — and none of them wrote down that
 * it had run. A job that silently stopped firing looked exactly like a job
 * that had nothing to do, and two overlapping invocations (a slow run and the
 * next tick, or a manual curl during a scheduled one) simply both ran.
 *
 * Now a route supplies its name, its maxDuration and the work, and this:
 *
 *   authorises — `Authorization: Bearer $CRON_SECRET`, compared in constant
 *                time. Without a configured secret it refuses outright rather
 *                than running unauthenticated.
 *   leases     — begin_job_run() takes the job's lease. The unique index on
 *                a running row IS the lock; a second invocation gets a
 *                `skipped` row and stands aside. The lease outlives
 *                maxDuration by thirty seconds, so a run the platform killed
 *                is presumed dead only once it certainly is.
 *   budgets    — the work gets maxDuration less ten seconds, so it stops by
 *                choice with its stats recorded rather than being killed with
 *                none.
 *   records    — finish_job_run() writes the outcome, duration and counts to
 *                job_runs; the platform log gets the same as one line.
 */

/** Stop this long before the platform would stop us. */
const SAFETY_MARGIN_MS = 10_000;
/** A lease that outlives the function, so it lapses only after the run is certainly over. */
const LEASE_GRACE_SECONDS = 30;

export type ScheduledWork = (
  ctx: JobContext & { admin: ReturnType<typeof createAdminClient> },
) => Promise<JobStats>;

export async function runScheduledJob(
  request: NextRequest,
  options: { job: string; maxDurationSeconds: number; work: ScheduledWork },
): Promise<NextResponse> {
  const { job, maxDurationSeconds } = options;

  // configuredValue: an unedited REPLACE_ME from the import file is a secret
  // printed in the repository, which is no secret at all.
  if (!authorised(request.headers.get('authorization'), configuredValue(env.cronSecret) ?? '')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  /*
    Guarded, because createAdminClient() throws when SUPABASE_SERVICE_ROLE_KEY
    is missing, and unguarded that surfaces as a 500 with a stack — the least
    diagnosable way to learn that a variable is unset. A job that fails
    silently at 1am is exactly the failure nobody notices until an employer
    asks why their advert is still up.
  */
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    logFailure('cron', 'cannot run: SUPABASE_SERVICE_ROLE_KEY is not configured', { job });
    return NextResponse.json(
      { job, error: 'unavailable', reason: 'service_role_missing' },
      { status: 503 },
    );
  }

  const result = await executeJobRun({
    job,
    leaseSeconds: maxDurationSeconds + LEASE_GRACE_SECONDS,
    budgetMs: Math.max(1_000, maxDurationSeconds * 1000 - SAFETY_MARGIN_MS),
    begin: (name, leaseSeconds) =>
      retryDb(() => admin.rpc('begin_job_run', { p_job: name, p_lease_seconds: leaseSeconds })),
    finish: async (id, status, stats, error) =>
      Boolean(
        await retryDb(() =>
          admin.rpc('finish_job_run', {
            p_id: id,
            p_status: status,
            p_stats: stats,
            p_error: error,
          }),
        ),
      ),
    work: (ctx) => options.work({ ...ctx, admin }),
    log: (event, detail) => {
      if (event === 'failed') logFailure('cron', `${job} ${event}`, detail);
      else logEvent('cron', `${job} ${event}`, detail);
    },
    now: Date.now,
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}

/**
 * Constant-time, and over digests so that the comparison does not leak the
 * secret's length either — timingSafeEqual refuses buffers of different
 * lengths, and returning early on that is its own timing signal.
 */
/**
 * Whether a request carries the cron secret, as runScheduledJob checks it: in
 * constant time, and never against a missing secret or an unedited
 * REPLACE_ME. For a cron route that does not run through runScheduledJob.
 */
export function cronAuthorised(request: NextRequest): boolean {
  return authorised(request.headers.get('authorization'), configuredValue(env.cronSecret) ?? '');
}

function authorised(header: string | null, secret: string): boolean {
  if (!secret || !header) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
