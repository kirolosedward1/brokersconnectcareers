import type { LeasedEmailRow, SettleLeasedOutcome } from '@/lib/supabase/database.types';
import type { Deadline } from './policy';

/**
 * The retry sweeper's loop, with the database and the mailer injected.
 *
 * What changed, and why this is its own file: the sweeper used to "release" a
 * failed row — clear its dedupe key, park it at attempts=99 — and let the
 * rebuilder claim a brand-new row for the same message. The new row started
 * at attempts=0 with a fresh created_at, so the three-attempt limit and the
 * three-day window never applied to anything: a message failing for a
 * transient reason was retried every hour, forever, each time as a stranger.
 *
 * Now a retry happens in place. lease_due_emails() hands out rows under a
 * token (FOR UPDATE SKIP LOCKED, so two sweeps never hold the same row); the
 * rebuild runs inside a retry context carrying that token; deliver() passes
 * it to claim_email, which hands the *same* row back instead of refusing the
 * key; and record_email_attempt counts the attempt on that row, with backoff,
 * up to the limit. What the rebuild did not record itself, this settles.
 *
 * Every decision below ends in exactly one settle or in deliver() having
 * recorded the attempt. A leased row left alone would sit locked until its
 * lease lapsed and then be leased again — and a row that keeps doing that is
 * dead-lettered by the lease counter as a worker-crasher, which is the right
 * verdict for a crash and the wrong one for an oversight here.
 *
 * Pure, with only type imports, so the tests can drive it with fakes under
 * `node --experimental-strip-types`.
 */

/**
 * What a rebuild running under the sweeper reports back.
 *
 * Written by deliver() (service.ts), read here. Mutable on purpose: the
 * rebuild's own return value is only 'sent' | 'skipped' | 'failed', and
 * "skipped because the recipient opted out" and "skipped because the key
 * belongs to a newer row" need to end the leased row in different ways.
 */
export type RetryContext = {
  /** The outbox row this retry is for. */
  leasedId: string;
  /** Proves the lease; claim_email hands the row back only to its holder. */
  leaseToken: string;
  /**
   * The leased row's attempt count when it was leased. deliver() passes it to
   * record_email_attempt so a replayed record cannot count one failure twice.
   */
  attempts: number;
  /** deliver() claimed the leased row and recorded the attempt on it. */
  touched: boolean;
  /** The leased row was claimed but the provider is not configured, so nothing was attempted. */
  deferred: boolean;
  /** deliver() claimed a different row — the message's key has moved on (a listing edited since, say). */
  claimedOther: boolean;
  /** claim_email itself failed, so nobody knows whether a claim happened. */
  claimError: boolean;
};

export type RebuildOutcome = 'sent' | 'skipped' | 'failed';

export type OutboxSweepDeps = {
  lease(limit: number): Promise<LeasedEmailRow[]>;
  settle(id: string, token: string, outcome: SettleLeasedOutcome, detail: string): Promise<boolean>;
  /** Rebuilt from the entity, and the recipient the row recorded (see rebuild.ts). */
  rebuilders: Record<string, (entityId: string, userId: string | null) => Promise<RebuildOutcome>>;
  runInRetryContext<T>(ctx: RetryContext, fn: () => Promise<T>): Promise<T>;
  deadline: Deadline;
};

export type OutboxSweepStats = {
  leased: number;
  sent: number;
  failed: number;
  cancelled: number;
  dead: number;
  deferred: number;
  superseded: number;
};

/**
 * Small batches, leased one at a time. Each lease is a promise to finish the
 * rows before it lapses; ten sequential sends is a promise that holds. The
 * provider's rate limit is the other reason: sends go out one after another,
 * never in parallel.
 */
const DEFAULT_BATCH = 10;

/**
 * How old a message may be and still be worth sending.
 *
 * Past this, a status update or a receipt is news about something that has
 * moved on. The database still stops leasing at three days (lease_due_emails,
 * reap_email_outbox); this is the tighter bound the sweeper enforces, because
 * changing that function would be a migration. A row inside the window is
 * sent. A row outside it is dead-lettered — gave_up_at set, status left
 * `failed` — which is the existing "not retryable" state, and an admin can
 * still requeue it. `suppressed` is not used: that status means the address
 * is blocked.
 *
 * Measured from the later of created_at and requeued_at, the same anchor the
 * database uses, so an admin requeue is a real second chance. An age that
 * cannot be read is outside the window too: a failed read is not a fresh row.
 */
export const EMAIL_RETRY_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * One supplied timestamp, or why it cannot be used.
 *
 * Absent means the caller never read the age (the lease itself does not
 * carry it). A value that does not parse was read and could not be trusted.
 */
function readAge(value: string | null | undefined): number | 'absent' | 'bad' {
  if (value == null || value === '') return 'absent';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 'bad' : parsed;
}

/**
 * The age was asked for and did not come back as a time: the read failed, the
 * row was missing from it, or the timestamp does not parse. That is outside
 * the window. A row the caller never dated — no `ageUnknown`, no timestamp —
 * is not this case.
 */
export function emailAgeUnreadable(row: {
  created_at?: string | null;
  requeued_at?: string | null;
  ageUnknown?: boolean;
}): boolean {
  if (row.ageUnknown) return true;
  const times = [readAge(row.created_at), readAge(row.requeued_at)];
  const readable = times.filter((time): time is number => typeof time === 'number');
  return readable.length === 0 && times.includes('bad');
}

export function emailRowIsStale(
  row: { created_at?: string | null; requeued_at?: string | null; ageUnknown?: boolean },
  now = Date.now(),
): boolean {
  // Fail closed. An age that cannot be read is not a reason to send.
  if (emailAgeUnreadable(row)) return true;
  const times = [readAge(row.created_at), readAge(row.requeued_at)].filter(
    (time): time is number => typeof time === 'number',
  );
  if (times.length === 0) return false;
  return now - Math.max(...times) > EMAIL_RETRY_MAX_AGE_MS;
}

/**
 * The lease does not return created_at. The sweeper reads it and merges it
 * on, so the age check above can see the row. A leased id the read did not
 * return is undated on purpose (`ageUnknown`): treated as outside the window,
 * not as fresh.
 */
export function mergeEmailAges<T extends { id: string }>(
  leased: readonly T[],
  ages: readonly { id: string; created_at: string; requeued_at: string | null; status?: string | null }[],
): (T & { created_at?: string; requeued_at?: string | null; status?: string; ageUnknown?: boolean })[] {
  const byId = new Map(ages.map((row) => [row.id, row]));
  return leased.map((row) => {
    const age = byId.get(row.id);
    if (!age) return { ...row, ageUnknown: true };
    return {
      ...row,
      created_at: age.created_at,
      requeued_at: age.requeued_at,
      status: age.status ?? undefined,
      ageUnknown: false,
    };
  });
}

/** The age read threw. Every leased row is outside the window until we know otherwise. */
export function markAgeUnknown<T extends { id: string }>(rows: readonly T[]): (T & { ageUnknown: true })[] {
  return rows.map((row) => ({ ...row, ageUnknown: true as const }));
}

export async function sweepOutbox(
  deps: OutboxSweepDeps,
  options: { batch?: number } = {},
): Promise<OutboxSweepStats> {
  const batch = Math.max(1, Math.floor(options.batch ?? DEFAULT_BATCH));
  const stats: OutboxSweepStats = {
    leased: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
    dead: 0,
    deferred: 0,
    superseded: 0,
  };

  while (!deps.deadline.expired()) {
    const rows = await deps.lease(batch);
    if (rows.length === 0) break;
    stats.leased += rows.length;

    // The whole batch, even past the deadline: these rows are leased, and
    // abandoning them would count against their lease budget for a crash that
    // did not happen. The deadline's margin is sized for one batch.
    //
    // For the same reason one row's failure does not end the batch. A settle
    // that throws (the database gone for longer than its retries) used to
    // propagate straight out of the loop and strand every row after it —
    // locked until the lease lapsed and one lease nearer the crash verdict,
    // with no crash anywhere. The first error is kept and thrown once the
    // batch is done, so the run is still recorded as failed; nothing more is
    // leased after it, because a database that just failed a settle will not
    // do better with the next ten.
    let firstError: unknown = null;
    for (const row of rows) {
      try {
        await sweepOne(deps, row, stats);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== null) throw firstError;

    // A short batch means the queue is drained; asking again would only
    // return nothing.
    if (rows.length < batch) break;
  }

  return stats;
}

async function sweepOne(deps: OutboxSweepDeps, row: LeasedEmailRow, stats: OutboxSweepStats) {
  // Already terminal, and not because a send failed. Leave the row exactly
  // as it is: no resend, no status change. The lease query does not hand
  // these out; this is the guard for one that changed underneath a lease.
  if (row.status === 'suppressed') return;

  // Too old to send, or so undated that it has to be treated as too old.
  // Dead-letter rather than rebuild, so the provider is not asked and the
  // row is not leased again next run. gave_up_at is what makes `failed` stop
  // being retryable; the status stays `failed`.
  if (emailRowIsStale(row)) {
    const detail = emailAgeUnreadable(row) ? 'age could not be read' : 'older than 48 hours';
    await deps.settle(row.id, row.lock_token, 'dead', detail);
    stats.dead += 1;
    return;
  }

  const rebuild = deps.rebuilders[row.template];

  // Nothing to rebuild from. A digest is a point-in-time list and stale is
  // worse than absent; a template with no rebuilder cannot be re-derived.
  // Straight to the dead letters rather than around the loop five times.
  if (!rebuild) {
    await deps.settle(row.id, row.lock_token, 'dead', `not retryable: ${row.template}`);
    stats.dead += 1;
    return;
  }
  if (!row.entity_id) {
    await deps.settle(row.id, row.lock_token, 'dead', 'not retryable: no entity');
    stats.dead += 1;
    return;
  }

  const ctx: RetryContext = {
    leasedId: row.id,
    leaseToken: row.lock_token,
    attempts: row.attempts,
    touched: false,
    deferred: false,
    claimedOther: false,
    claimError: false,
  };

  let outcome: RebuildOutcome;
  try {
    const entityId = row.entity_id;
    outcome = await deps.runInRetryContext(ctx, () => rebuild(entityId, row.user_id ?? null));
  } catch {
    // The notify functions do not throw, so this is a bug or an outage in the
    // rebuild itself. Counted as an attempt so it cannot loop forever.
    await deps.settle(row.id, row.lock_token, 'failed', 'rebuild threw');
    stats.failed += 1;
    return;
  }

  // The leased row was claimed but the provider key is missing: an
  // environment problem, not the message's. Try again later without spending
  // an attempt; the retry window still bounds it.
  if (ctx.deferred) {
    await deps.settle(row.id, row.lock_token, 'defer', 'provider not configured');
    stats.deferred += 1;
    return;
  }

  // deliver() claimed this row and recorded the attempt itself — sent, or
  // failed with backoff or dead-lettered. Nothing left to settle.
  if (ctx.touched) {
    if (outcome === 'sent') stats.sent += 1;
    else stats.failed += 1;
    return;
  }

  // Nobody knows whether a claim happened. Spend an attempt, so an outage
  // that outlasts five of them ends in the dead letters rather than a loop.
  //
  // Checked before the superseded case below, not after: a rebuild that
  // writes to several people (a new application goes to every member of the
  // company) can claim a fresh row for a member who joined since while the
  // leased member's own claim fails. The fresh row says nothing about the
  // leased one, whose key never moved and whose message never went —
  // cancelling it as superseded lost it without a trace.
  if (ctx.claimError) {
    await deps.settle(row.id, row.lock_token, 'failed', 'claim failed');
    stats.failed += 1;
    return;
  }

  // The rebuild failed without recording anything on the leased row: a read
  // it needed errored (the composers report that as 'failed' rather than as
  // "the recipient is gone"), or it threw inside its own catch. That is an
  // outage, not "nothing to send", and cancelling it was terminal — not
  // retried, not a dead letter, not requeueable. A failed attempt instead:
  // backoff, the same budget, and the dead letters at the end if it lasts.
  // Ahead of the superseded case for the multi-recipient reason above; when a
  // failure was only another row's recorded send, the retry finds that key
  // held and ends as cancelled then, at the cost of one extra rebuild.
  if (outcome === 'failed') {
    await deps.settle(row.id, row.lock_token, 'failed', 'rebuild failed');
    stats.failed += 1;
    return;
  }

  // The message's key has moved on — a listing edited since, a status changed
  // again — and the current version went out on its own row. This one
  // describes something that no longer exists.
  if (ctx.claimedOther) {
    await deps.settle(row.id, row.lock_token, 'cancelled', 'superseded by a new row');
    stats.superseded += 1;
    return;
  }

  // The rebuild decided there was nothing to send: the recipient turned the
  // stream off, the entity is gone, the address is suppressed (in which case
  // claim_email already closed the row and this settle is a harmless no-op).
  await deps.settle(row.id, row.lock_token, 'cancelled', 'nothing to send on retry');
  stats.cancelled += 1;
}
