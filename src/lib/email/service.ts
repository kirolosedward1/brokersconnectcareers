import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logFailure } from '@/lib/observe';
import { retryDbResult } from '@/lib/jobs/db';
import { currentRetryContext } from '@/lib/jobs/retry-context';
import { sendEmail, type SendOutcome } from './send';
import { TEMPLATES, isEssential, type TemplateName } from './templates';
import {
  claimInsert,
  newEmailLogId,
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
 * A first send is born from an insert whose id the app chose. claim_email
 * remains the retry path: a sweeper already holds the row, and the lease
 * token is what hands it back. This is the way out when that insert failed,
 * or when it succeeded and recording the outcome did not: one upsert or one
 * update, and never a write that could turn a sent row back into a failed one.
 * The upsert conflicts on the attempt's id, so a claim that committed and
 * then timed out stays that row. A dedupe key still refuses a second attempt
 * that picked its own id.
 */
function emailLogSink(admin: ReturnType<typeof createAdminClient>): EmailLogSink {
  return {
    async insertFailed(row) {
      // Same id: the claim and this fallback are one row, key or no key.
      // ignoreDuplicates leaves whatever won — queued, sent, sent_at — as it
      // is. A different id with the same dedupe key hits the unique index;
      // that is the other attempt, not a second message.
      const { error } = await admin.from('email_log').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
      if (error?.code === '23505') return { error: null };
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
   * What makes two sends the same send. Required, so a caller cannot forget
   * one and have every retry become a new message. A send with a natural id
   * — an application, a listing version, a decision — builds it from the
   * template, the recipient, and that id. The pre-generated row id is the
   * other half: a lost claim response still converges on one row.
   */
  dedupeKey: string;
  envelope: Envelope;
};

type DbWriteError = { code?: string; message: string } | null;

/**
 * The same refusal claim_email records, checked before the insert because
 * that function mints its own id and cannot be given one without a migration.
 * A complaint does not stop a security notice. Nothing else gets past a
 * suppressed address, a reserved domain, or thirty messages to one inbox in
 * an hour.
 */
async function refusalReason(
  admin: ReturnType<typeof createAdminClient>,
  spec: DeliverySpec,
): Promise<{ reason: string | null; error: DbWriteError }> {
  if (isUndeliverableDomain(spec.to)) return { reason: 'reserved domain, cannot receive mail', error: null };

  const blocked = await admin.from('email_suppressions').select('reason').eq('email', spec.to.toLowerCase()).maybeSingle();
  if (blocked.error) return { reason: null, error: { code: blocked.error.code, message: blocked.error.message } };

  const essential = isEssential(spec.template);
  if (blocked.data && !(blocked.data.reason === 'complaint' && essential)) {
    return { reason: `address is suppressed (${blocked.data.reason})`, error: null };
  }

  if (!essential) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = await admin
      .from('email_log')
      .select('id', { count: 'exact', head: true })
      .ilike('recipient', escapeLike(spec.to))
      .gt('created_at', since)
      .neq('status', 'suppressed');
    if (recent.error) return { reason: null, error: { code: recent.error.code, message: recent.error.message } };
    if ((recent.count ?? 0) >= 30) return { reason: 'recipient hourly ceiling reached', error: null };
  }

  return { reason: null, error: null };
}

/** RFC 2606 / 6761, the same list as is_undeliverable_domain. The part after the first @. */
function isUndeliverableDomain(email: string): boolean {
  const domain = (email.split('@')[1] ?? '').toLowerCase();
  if (domain === 'test' || domain === 'invalid' || domain === 'example' || domain === 'localhost') return true;
  if (domain === 'example.com' || domain === 'example.net' || domain === 'example.org') return true;
  return domain.endsWith('.test') || domain.endsWith('.invalid') || domain.endsWith('.example') || domain.endsWith('.localhost');
}

/** LIKE treats _ and % as wildcards. An address is a literal. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Insert the outbox row under an id this process already holds.
 *
 * A unique violation is not always "do not send". The retry of an insert that
 * committed and lost its answer collides with this id, and the row is queued
 * and still ours to send. A collision on the dedupe key, or a row that is
 * already suppressed, is somebody else's or already finished: send nothing.
 */
async function insertClaim(
  admin: ReturnType<typeof createAdminClient>,
  spec: DeliverySpec,
  id: string,
): Promise<{ data: string | null; error: DbWriteError }> {
  const refusal = await refusalReason(admin, spec);
  if (refusal.error) return { data: null, error: refusal.error };

  const row = claimInsert({ ...spec, id });
  if (refusal.reason) {
    const { error } = await admin.from('email_log').insert({
      ...row,
      status: 'suppressed',
      error: refusal.reason,
      next_attempt_at: null,
    });
    if (error && error.code !== '23505') return { data: null, error: { code: error.code, message: error.message } };
    return { data: null, error: null };
  }

  const { error } = await admin.from('email_log').insert(row);
  if (!error) return { data: id, error: null };
  if (error.code !== '23505') return { data: null, error: { code: error.code, message: error.message } };

  const found = await admin.from('email_log').select('status').eq('id', id).maybeSingle();
  if (found.error) return { data: null, error: { code: found.error.code, message: found.error.message } };
  if (found.data?.status === 'queued') return { data: id, error: null };
  return { data: null, error: null };
}

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

  // The id is chosen here, before the insert, and every retry of that insert
  // uses it again. A first attempt that commits and loses its answer collides
  // with itself instead of minting a second row. A sweeper retry already has
  // its row; claim_email hands that one back, and a new id would be a second
  // message.
  const attemptId = retry ? null : newEmailLogId();
  const { data: claimed, error: claimError } = await retryDbResult(() =>
    retry
      ? admin.rpc('claim_email', {
          p_dedupe_key: spec.dedupeKey,
          p_template: spec.template,
          p_recipient: spec.to,
          p_user_id: spec.userId ?? null,
          p_entity_type: spec.entity?.type ?? null,
          p_entity_id: spec.entity?.id ?? null,
          p_essential: isEssential(spec.template),
          p_lock_token: retry.leaseToken,
        })
      : insertClaim(admin, spec, attemptId as string),
  );

  if (claimError) {
    if (retry) retry.claimError = true;
    logFailure('email', 'could not claim', { template: spec.template, code: claimError.code });
    // The claim is what normally inserts the row. On a first send it just
    // failed, so without a row of our own the attempt is invisible to the
    // sweeper. The fallback upserts the same id: if the insert had in fact
    // committed, that is a no-op and the queued row is the one the sweeper
    // sends; if it never landed, this is the failed row. A retry already has
    // the leased row; the sweep records the failure on that one.
    // If the client itself is what failed — the invalid key — the insert
    // fails too, and is reported rather than thrown.
    if (attemptId) await persistFailedSend(sink, { ...spec, id: attemptId }, claimError);
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
    if (result.outcome === 'failed') await persistFailedSend(sink, { ...spec, id: logId }, storedError ?? recordError, logId);
  }

  return result.outcome;
}
