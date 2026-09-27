import type { NextRequest } from 'next/server';
import { runScheduledJob } from '@/lib/jobs/run';
import { retryDb } from '@/lib/jobs/db';
import { sweepOutbox } from '@/lib/jobs/outbox-sweep';
import { runInRetryContext } from '@/lib/jobs/retry-context';
import { REBUILDERS } from '@/lib/email/rebuild';

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
 */

/** How long a leased row is ours. Longer than one batch takes; shorter than the gap between runs. */
const LEASE_SECONDS = 90;
/** Sent one after another — the provider has a rate limit, and a burst earns 429s. */
const BATCH = 10;

export async function GET(request: NextRequest) {
  return runScheduledJob(request, {
    job: 'email-retry',
    maxDurationSeconds: maxDuration,
    work: async ({ admin, deadline }) =>
      sweepOutbox(
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
      ),
  });
}
