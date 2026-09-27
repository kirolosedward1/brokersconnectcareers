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
 *   files   — uploads nothing references any more: replaced avatars, logos
 *             and CVs, a deleted account's files, a CV from an application
 *             that was never sent. orphaned_storage_objects() decides, and
 *             its rules lean towards keeping (migration 70); this only
 *             removes what it names, a bounded batch an hour, through the
 *             Storage API so the bytes go too. A second run finds the same
 *             names already gone, which Storage answers without error.
 *
 * Each step runs even if an earlier one failed — they are unrelated, and a
 * broken relabel is no reason to stop reaping. The run is still marked
 * failed if any did.
 */

const KEEP_RUNS = '90 days';
/** Files removed per hourly run: a backlog drains over a day, never in one burst. */
const ORPHAN_BATCH = 100;

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

      const files = await step('files', async () => {
        const orphans = await retryDb(() =>
          admin.rpc('orphaned_storage_objects', { p_limit: ORPHAN_BATCH }),
        );
        const byBucket = new Map<string, string[]>();
        for (const { bucket_id, name } of orphans ?? []) {
          byBucket.set(bucket_id, [...(byBucket.get(bucket_id) ?? []), name]);
        }
        let removed = 0;
        for (const [bucket, names] of byBucket) {
          const { data, error } = await admin.storage.from(bucket).remove(names);
          // Counted and named by bucket only — the object names carry user ids.
          if (error) throw Object.assign(new Error(`remove failed in ${bucket}`), { code: bucket });
          removed += data?.length ?? 0;
        }
        return removed;
      });

      if (failures.length) throw new Error(`maintenance steps failed: ${failures.join(', ')}`);
      return { expired, reaped, pruned, files_removed: files };
    },
  });
}
