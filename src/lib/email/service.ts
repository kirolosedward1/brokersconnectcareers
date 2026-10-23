import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logFailure } from '@/lib/observe';
import { retryDbResult } from '@/lib/jobs/db';
import { currentRetryContext } from '@/lib/jobs/retry-context';
import { sendEmail, type SendOutcome } from './send';
import { TEMPLATES, isEssential, type TemplateName } from './templates';
import {
  persistFailedSend,
  reportUnloggedSend,
  scrubEmailError,
  type EmailLogSink,
} from './attempt-log';

/**
 * The one funnel every message goes through.
 *
 * Above this line, code decides *what* to say and *to whom*. Below it,
 * send.ts talks to the provider. This is the part in between that makes the
 * difference between a `fetch` call and infrastructure:
 *
 *   claim   — one row per logical message, keyed on what makes two sends the
 *             same send. A duplicate loses the insert and returns without
 *             sending. This is why a retried webhook, a double-clicked button
 *             and a re-run cron produce one email rather than three.
 *
 *   record  — `sent` is written only when the provider accepted it, and it
 *             means exactly that. `delivered` is written only by the webhook.
 *
 *   survive — nothing here throws. A send that fails leaves a row the sweeper
 *             can pick up; a database that is unreachable leaves the message
 *             unsent and the *action that triggered it* untouched, which is
 *             the only ordering that is ever acceptable.
 *
 * The attempt limit is enforced in the database (record_email_attempt) rather
 * than in the sweeper, so that it holds for every path, including a caller
 * that retries by hand. This is the copy the runtime can read.
 *
 * A retry is the same row, not a new one. When the sweeper rebuilds a failed
 * message it runs the rebuild inside a retry context holding the row's lease
 * token (jobs/retry-context.ts); deliver() passes that token to claim_email,
 * which hands the leased row back instead of refusing its key, and the attempt
 * is counted on it — with backoff, and dead-lettered at the limit. deliver()
 * also tells the sweeper what it did with the row (touched, deferred, claimed
 * another), because the rebuild's 'skipped' alone cannot say which.
 */

export { MAX_EMAIL_ATTEMPTS as MAX_ATTEMPTS } from '@/lib/jobs/policy';

/**
 * The outbox writes, narrowed to the two a failure needs.
 *
 * claim_email is still how a row is normally born. This is the way out when
 * that call failed, or when it succeeded and recording the outcome did not:
 * one insert or one update, and never a write that could turn a sent row
 * back into a failed one.
 */
function emailLogSink(admin: ReturnType<typeof createAdminClient>): EmailLogSink {
  return {
    async findExisting(lookup) {
      // dedupe_key is unique, so it is the attempt. A null key is not: two
      // nulls do not conflict, and the claim row cannot be found by it. Match
      // the message — entity id, template, recipient — inside the window the
      // caller computed. There is no message-id column; entity_id is the
      // subject the row was written about, which is what survived the lost
      // response.
      if (lookup.dedupeKey) {
        const { data, error } = await admin.from('email_log').select('id').eq('dedupe_key', lookup.dedupeKey).limit(1);
        if (error) return { row: null, error: { code: error.code, message: error.message } };
        const id = data?.[0]?.id;
        return { row: id ? { id } : null, error: null };
      }
      let query = admin
        .from('email_log')
        .select('id')
        .eq('template', lookup.template)
        .eq('recipient', lookup.recipient)
        .gte('created_at', lookup.createdAfter);
      if (lookup.entityId) query = query.eq('entity_id', lookup.entityId);
      const { data, error } = await query.limit(1);
      if (error) return { row: null, error: { code: error.code, message: error.message } };
      const id = data?.[0]?.id;
      return { row: id ? { id } : null, error: null };
    },
    async insertFailed(row) {
      // On conflict do nothing: the row that won the race — the claim whose
      // answer was lost, or the other fallback — stays as it is, sent_at
      // included. A null key has nothing to conflict on; the lookup above is
      // what keeps that attempt to one row.
      const write = row.dedupe_key
        ? admin.from('email_log').upsert(row, { onConflict: 'dedupe_key', ignoreDuplicates: true })
        : admin.from('email_log').insert(row);
      const { error } = await write;
      return { error: error ? { code: error.code, message: error.message } : null };
    },
    async updateFailed(id, patch) {
      const { error } = await admin
        .from('email_log')
        .update(patch)
        .eq('id', id)
        .in('status', ['queued', 'failed']);
      return { error: error ? { code: error.code, message: error.message } : null };
    },
  };
}

export type Envelope = {
  subject: string;
  html: string;
  text: string;
  /** Present on optional mail, absent on transactional. */
  unsubscribeUrl?: string;
};

export type DeliverySpec = {
  /** Registry name, e.g. 'application_receipt'. Also what the sweeper rebuilds by. */
  template: TemplateName;
  to: string;
  userId?: string | null;
  entity?: { type: string; id: string } | null;
  /**
   * What makes two sends the same send. Omit only for messages with no natural
   * key — those simply are not deduplicated, which is better than inventing a
   * key that collides.
   */
  dedupeKey?: string | null;
  envelope: Envelope;
};

export async function deliver(spec: DeliverySpec): Promise<SendOutcome> {
  /*
    The category and the envelope must agree. A preference stream without an
    unsubscribe is mail the recipient cannot stop, which is what gets a domain
    filtered; a security notice with one invites somebody to switch off the
    message that tells them their password changed. Either is a template bug,
    and refusing here makes it a loud one rather than a quiet deliverability
    or safety problem.
  */
  const optional = TEMPLATES[spec.template] === 'preference';
  if (optional !== Boolean(spec.envelope.unsubscribeUrl)) {
    console.warn(`[email] "${spec.template}" has the wrong unsubscribe for its category; not sending`);
    return 'failed';
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    // No service-role key, so there is no client to write a row with. Say so
    // and stop. Sending anyway would be an email nobody could account for,
    // which is the thing this module exists to replace. Under a retry the
    // sweeper is told to wait, rather than cancelling the leased row as if
    // there were nothing to send.
    const retry = currentRetryContext();
    if (retry) retry.deferred = true;
    reportUnloggedSend(spec.template, spec.to, error);
    return 'skipped';
  }
  const sink = emailLogSink(admin);

  // The sweeper's retry, if this call is one. Undefined for every ordinary
  // send, which then claims exactly as it always has.
  const retry = currentRetryContext();

  // Retried through a dropped connection, never through a refusal. A retry
  // after an insert that committed but whose answer was lost finds the key
  // held and returns null — the message is then not sent now, and its row is
  // waiting for the sweeper, which is the safe side of that coin.
  const { data: claimed, error: claimError } = await retryDbResult(() =>
    admin.rpc('claim_email', {
      p_dedupe_key: spec.dedupeKey ?? null,
      p_template: spec.template,
      p_recipient: spec.to,
      p_user_id: spec.userId ?? null,
      p_entity_type: spec.entity?.type ?? null,
      p_entity_id: spec.entity?.id ?? null,
      p_essential: isEssential(spec.template),
      p_lock_token: retry?.leaseToken ?? null,
    }),
  );

  if (claimError) {
    if (retry) retry.claimError = true;
    logFailure('email', 'could not claim', { template: spec.template, code: claimError.code });
    // The claim is what normally inserts the row. On a first send it just
    // failed, so without a row of our own the attempt is invisible to the
    // sweeper. A retry already has the leased row; the sweep records the
    // failure on that one, and a second insert would be a second message.
    // If the client itself is what failed — the invalid key — the insert
    // fails too, and is reported rather than thrown.
    if (!retry) await persistFailedSend(sink, spec, claimError);
    return 'failed';
  }

  // Null means somebody already holds this key, the address is suppressed, or
  // it has reached its hourly ceiling. All are "do not send", none an error.
  // (Under a retry, a suppressed address also closes the leased row, inside
  // claim_email.)
  if (!claimed) return 'skipped';
  const logId = claimed as string;

  // Which row this is, from the sweeper's point of view: the one it leased
  // (the retry proper) or a different one (the message's key has moved on
  // since the failure, and the leased row is now superseded).
  const isLeasedRow = retry !== undefined && logId === retry.leasedId;
  if (retry) {
    if (isLeasedRow) retry.touched = true;
    else retry.claimedOther = true;
  }

  const result = await sendEmail({ to: spec.to, ...spec.envelope, idempotencyKey: logId });

  // No provider key. The row stays `queued` with its attempt count untouched,
  // so the sweeper picks it up once the key is configured — recording this as
  // a failure would spend the retry budget on an environment problem and lose
  // every message sent during the gap. Under a retry the sweeper is told, so
  // it can push the row back an hour rather than leave it locked.
  if (result.outcome === 'skipped') {
    if (isLeasedRow) retry.deferred = true;
    return 'skipped';
  }

  // Recorded in SQL rather than read-modify-write, because the sweeper may be
  // looking at the same row. The same call clears a retry's lease and sets
  // the next attempt's time, so a leased row is finished here, not by the
  // sweeper.
  //
  // A failure that cannot succeed on a second attempt — a malformed address,
  // a refused domain — exhausts the budget immediately rather than being
  // retried four more times to fail identically. `exhaust` is how that is
  // said, and it dead-letters the row in one step.
  //
  // p_expected_attempts makes the retry below safe. A dropped connection is
  // exactly when the first call may have committed and only its answer was
  // lost; replayed, a `failed` record used to pass the status guard again and
  // count one failure twice. With the count this attempt started from — zero
  // for a row claim_email has just inserted, the leased count for the
  // sweeper's retry — the replay matches no row.
  const expectedAttempts = isLeasedRow ? retry.attempts : 0;
  const storedError = result.error ? scrubEmailError(result.error) : null;
  const { error: recordError } = await retryDbResult(() =>
    admin.rpc('record_email_attempt', {
      p_id: logId,
      p_status: result.outcome === 'sent' ? 'sent' : 'failed',
      p_provider_id: result.providerId ?? null,
      p_error: storedError,
      p_exhaust: result.outcome !== 'sent' && result.retryable !== true,
      p_expected_attempts: expectedAttempts,
    }),
  );

  if (recordError) {
    logFailure('email', 'could not record', {
      template: spec.template,
      email_log: logId,
      code: recordError.code,
    });
    // The row exists (the claim inserted it) but still says `queued`. A failed
    // send has to say `failed`, or the only record of the attempt is a row
    // that looks unattempted. The update keeps a sent row's sent_at intact.
    if (result.outcome === 'failed') await persistFailedSend(sink, spec, storedError ?? recordError, logId);
  }

  return result.outcome;
}
