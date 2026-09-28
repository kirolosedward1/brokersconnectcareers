import type { NextRequest } from 'next/server';
import { runScheduledJob } from '@/lib/jobs/run';
import { retryDb } from '@/lib/jobs/db';
import { sweepOutbox } from '@/lib/jobs/outbox-sweep';
import { runInRetryContext } from '@/lib/jobs/retry-context';
import { REBUILDERS } from '@/lib/email/rebuild';
import { logFailure } from '@/lib/observe';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The retry sweeper.
 *
 * A message that failed inside an after() callback has nowhere to be retried
 * from — the request is over. This is where it gets picked up: the outbox row
 * is the queue, and lease_due_emails() is how a sweeper takes rows off it.
 *
 * Deliberately not a real queue product. This platform already runs Vercel
 * Cron and already has Postgres, and a message that goes out an hour late is
 * a message that went out — introducing a broker, a worker and a second
 * deployment target to save that hour would be the wrong trade for a job
 * board. What matters is that nothing is silently lost, and the outbox is
 * what guarantees that.
 *
 * A retry happens on the same row. The row is leased (FOR UPDATE SKIP
 * LOCKED, with a token and an expiry), the message is rebuilt from its entity
 * under that token, and claim_email hands the leased row back so the attempt
 * is counted where the earlier ones were. It used to be released and claimed
 * afresh as a new row at attempts=0 — which reset every bound below, so a
 * transient failure was retried every hour indefinitely.
 *
 * Bounded four ways, because an unbounded retry loop against a paid provider
 * is worse than a lost email: five attempts per message with exponential
 * backoff (~10m, 40m, 2h40m, 10h40m, jittered), a three-day window from the
 * first attempt, a cap of eight leases per row (a row that keeps crashing its
 * worker is dead-lettered rather than crashing it forever), and this run's
 * time budget. Rows that exhaust any of them are dead letters: gave_up_at
 * set, listed on /admin/operations, and requeueable from there by hand.
 *
 * Rows younger than five minutes are not due yet: next_attempt_at defaults to
 * five minutes after the claim, because such a row is probably mid-send in an
 * after() callback right now, and re-sending it would defeat the claim.
 *
 * Every ten minutes, so the first backoff step is honoured to within ten
 * minutes rather than an hour. An empty run is one indexed query.
 *
 * Two housekeeping statements go first, each idempotent and each cheap enough
 * to repeat every ten minutes: reap_email_outbox() dead-letters rows past the
 * retry window or leased too often — without it they would sit `queued`
 * forever, invisible, because nothing is due to look at them — and
 * prune_job_runs() keeps the run log to ninety days. They live here rather
 * than in a cron of their own because this is the job that owns the outbox;
 * listing expiry and file cleanup belong to the lifecycle job (migration 204).
 * A failure in either is logged and does not stop the sweep.
 */

/** How long a leased row is ours. Longer than one batch takes; shorter than the gap between runs. */
const LEASE_SECONDS = 90;
/** Sent one after another — the provider has a rate limit, and a burst earns 429s. */
const BATCH = 10;
/** How long job_runs rows are kept. The table is for "is it working", not an archive. */
const KEEP_RUNS = '90 days';

export async function GET(request: NextRequest) {
  return runScheduledJob(request, {
    job: 'email-retry',
    maxDurationSeconds: maxDuration,
    work: async ({ admin, deadline }) => {
      const housekeeping = async (name: string, fn: () => Promise<number | null>) => {
        try {
          return (await fn()) ?? 0;
        } catch (error) {
          logFailure('email-retry', `${name} failed`, { code: (error as { code?: string } | null)?.code });
          return 0;
        }
      };
      const reaped = await housekeeping('reap', () => retryDb(() => admin.rpc('reap_email_outbox')));
      const pruned = await housekeeping('prune', () =>
        retryDb(() => admin.rpc('prune_job_runs', { p_keep: KEEP_RUNS })),
      );

      const swept = await sweepOutbox(
        {
          lease: async (limit) =>
            (await retryDb(() =>
              admin.rpc('lease_due_emails', { p_limit: limit, p_lease_seconds: LEASE_SECONDS }),
            )) ?? [],
          settle: async (id, token, outcome, detail) =>
            Boolean(
              await retryDb(() =>
                admin.rpc('settle_leased_email', {
                  p_id: id,
                  p_lock_token: token,
                  p_outcome: outcome,
                  p_detail: detail,
                }),
              ),
            ),
          rebuilders: REBUILDERS,
          runInRetryContext,
          deadline,
        },
        { batch: BATCH },
      );
      return { reaped, pruned_runs: pruned, ...swept };
    },
  });
}
