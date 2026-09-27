import type { NextRequest } from 'next/server';
import { runScheduledJob } from '@/lib/jobs/run';
import { retryDb } from '@/lib/jobs/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Hourly housekeeping. No email, ever — every step is a single idempotent
 * statement, and running one twice or late changes nothing.
 *
 *   expire  — the active -> expired relabel, so a listing stops being shown
 *             within the hour it lapses rather than at 1am. The notices stay
 *             with the nightly job; this only moves the status.
 *             expire_stale_jobs() is one UPDATE whose WHERE is re-checked
 *             after any row-lock wait, so overlapping with the nightly run,
 *             or with an employer closing the listing by hand, is safe.
 *   reap    — outbox rows that can never be retried are dead-lettered: past
 *             the three-day window, or leased eight times by workers that
 *             never came back. Without this they would sit `queued` forever,
 *             invisible because nothing is due to look at them.
 *   prune   — job_runs older than ninety days. The table is for "is it
 *             working", not an archive.
 *
 * Each step runs even if an earlier one failed — they are unrelated, and a
 * broken relabel is no reason to stop reaping. The run is still marked
 * failed if any did.
 */

const KEEP_RUNS = '90 days';

export async function GET(request: NextRequest) {
  return runScheduledJob(request, {
    job: 'maintenance',
    maxDurationSeconds: maxDuration,
    work: async ({ admin }) => {
      const failures: string[] = [];
      const step = async (name: string, fn: () => Promise<number | null>) => {
        try {
          return (await fn()) ?? 0;
        } catch (error) {
          const code = (error as { code?: string } | null)?.code;
          failures.push(code ? `${name} (${code})` : name);
          return 0;
        }
      };

      const expired = await step('expire', () => retryDb(() => admin.rpc('expire_stale_jobs')));
      const reaped = await step('reap', () => retryDb(() => admin.rpc('reap_email_outbox')));
      const pruned = await step('prune', () =>
        retryDb(() => admin.rpc('prune_job_runs', { p_keep: KEEP_RUNS })),
      );

      if (failures.length) throw new Error(`maintenance steps failed: ${failures.join(', ')}`);
      return { expired, reaped, pruned };
    },
  });
}
