import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logFailure } from '@/lib/observe';
import { retryDbResult } from '@/lib/jobs/db';
import { currentRetryContext } from '@/lib/jobs/retry-context';
import { sendEmail, type SendOutcome } from './send';
import { TEMPLATES, isEssential, type TemplateName } from './templates';

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
  } catch {
    // No service-role key. Sending would still work, but nothing could be
    // recorded or deduplicated — and an email system that cannot say what it
    // sent is the thing this module exists to replace.
    console.warn(`[email] no service role; not sending "${spec.template}"`);
    return 'skipped';
  }

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
  const { error: recordError } = await retryDbResult(() =>
    admin.rpc('record_email_attempt', {
      p_id: logId,
      p_status: result.outcome === 'sent' ? 'sent' : 'failed',
      p_provider_id: result.providerId ?? null,
      p_error: result.error ?? null,
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
  }

  return result.outcome;
}
