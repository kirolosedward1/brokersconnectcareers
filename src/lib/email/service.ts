import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail, type SendOutcome } from './send';

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
 * The attempt limit lives here rather than in the sweeper so that it holds for
 * every path, including a caller that retries by hand.
 */

export const MAX_ATTEMPTS = 3;

export type Envelope = {
  subject: string;
  html: string;
  text: string;
  /** Present on optional mail, absent on transactional. */
  unsubscribeUrl?: string;
};

export type DeliverySpec = {
  /** Registry name, e.g. 'application_receipt'. Also what the sweeper rebuilds by. */
  template: string;
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

  const { data: claimed, error: claimError } = await admin.rpc('claim_email', {
    p_dedupe_key: spec.dedupeKey ?? null,
    p_template: spec.template,
    p_recipient: spec.to,
    p_user_id: spec.userId ?? null,
    p_entity_type: spec.entity?.type ?? null,
    p_entity_id: spec.entity?.id ?? null,
  });

  if (claimError) {
    console.warn(`[email] could not claim "${spec.template}":`, claimError.message);
    return 'failed';
  }

  // Null means somebody already holds this key, or the address is suppressed.
  // Both are "do not send", and neither is an error.
  if (!claimed) return 'skipped';
  const logId = claimed as string;

  const result = await sendEmail({ to: spec.to, ...spec.envelope });

  // No provider key. The row stays `queued` with its attempt count untouched,
  // so the sweeper picks it up once the key is configured — recording this as
  // a failure would spend the retry budget on an environment problem and lose
  // every message sent during the gap.
  if (result.outcome === 'skipped') return 'skipped';

  // Recorded in SQL rather than read-modify-write, because the sweeper may be
  // looking at the same row.
  //
  // A failure that cannot succeed on a second attempt — a malformed address,
  // a refused domain — exhausts the budget immediately rather than being
  // retried twice more to fail identically. `exhaust` is how that is said, and
  // it keeps the sweeper's query to one condition.
  const { error: recordError } = await admin.rpc('record_email_attempt', {
    p_id: logId,
    p_status: result.outcome === 'sent' ? 'sent' : 'failed',
    p_provider_id: result.providerId ?? null,
    p_error: result.error ?? null,
    p_exhaust: result.outcome !== 'sent' && result.retryable !== true,
  });

  if (recordError) {
    console.warn(`[email] could not record "${spec.template}":`, recordError.message);
  }

  return result.outcome;
}

/**
 * Address-level suppression, checked in the database at claim time. Exposed
 * here for the webhook, which is the only thing that adds to it.
 */
export async function suppress(email: string, reason: 'hard_bounce' | 'complaint') {
  try {
    await createAdminClient()
      .from('email_suppressions')
      .upsert({ email: email.toLowerCase(), reason }, { onConflict: 'email' });
  } catch (error) {
    console.warn('[email] could not suppress:', error instanceof Error ? error.message : error);
  }
}
