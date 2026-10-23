/**
 * A failed send that never reached the outbox.
 *
 * claim_email writes the email_log row before the provider is asked, and
 * record_email_attempt marks it sent or failed afterwards. When the claim
 * itself fails — an invalid service-role key, a client that cannot be built —
 * there is no row, the retry sweeper never sees the message, and it is gone.
 * This writes that row anyway, with the existing `failed` status.
 *
 * `failed` is already what lease_due_emails retries, alongside `queued`, for
 * as long as gave_up_at is null. The row leaves gave_up_at unset and sets
 * next_attempt_at to now, so the next sweep can lease it. `suppressed` is not
 * used: that status means the address is blocked, and the sweeper does not
 * retry it.
 *
 * No server-only marker and no database client: the caller hands in the
 * write, and the tests drive it with a fake. Nothing here throws. A database
 * that is the thing that failed cannot be written to; that is reported and
 * swallowed, because a lost log line must not fail the action that asked for
 * the email.
 */

const MAX_ERROR_LENGTH = 500;

export type FailedEmailInsert = {
  template: string;
  recipient: string;
  status: 'failed';
  error: string;
  dedupe_key: string | null;
  user_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  /** Due now. Null would mean "finished", and the sweeper would never take it. */
  next_attempt_at: string;
};

export type EmailLogWriteResult = { error: { code?: string | null; message: string } | null };

/**
 * The two writes a failure may need. An update when the row already exists
 * (the claim worked, recording it did not) and an insert when it does not.
 */
export type EmailLogSink = {
  insertFailed(row: FailedEmailInsert): Promise<EmailLogWriteResult>;
  updateFailed(
    id: string,
    patch: { status: 'failed'; error: string; next_attempt_at: string },
  ): Promise<EmailLogWriteResult>;
};

export type FailedSendSpec = {
  template: string;
  to: string;
  dedupeKey?: string | null;
  userId?: string | null;
  entity?: { type: string; id: string } | null;
};

/** The domain only. The local part is contact data and does not belong in a log line. */
export function recipientDomain(recipient: string): string {
  const address = typeof recipient === 'string' ? recipient : '';
  const at = address.lastIndexOf('@');
  const domain = (at >= 0 ? address.slice(at + 1) : '').trim().toLowerCase();
  if (!domain || domain.length > 253 || !/^[a-z0-9.-]+$/.test(domain) || !domain.includes('.')) return 'unknown';
  return domain;
}

/**
 * Provider and database text, safe to store and to print.
 *
 * Addresses, bearer tokens, JWTs and key-shaped strings are replaced. The
 * result is capped, because email_log.error is a diagnosis, not a transcript,
 * and a token in an error message must not become a copy of the secret.
 */
export function scrubEmailError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : typeof error === 'string'
          ? error
          : 'send failed';

  const cleaned = raw
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<address>')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,}){1,2}\b/g, '<secret>')
    .replace(/\bBearer\s+\S+/gi, 'Bearer <secret>')
    .replace(/\b(?:bearer|token|apikey|api_key|access_token|refresh_token|service_role|secret)\s*[:=]\s*\S+/gi, '<secret>')
    .replace(/\b(?:sb_secret|sb_publishable|sk|rk|pk|re)_[A-Za-z0-9_-]{6,}\b/g, '<secret>')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '<secret>')
    .replace(/\s+/g, ' ')
    .trim();

  const text = cleaned || 'send failed';
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…` : text;
}

/** One structured line. Template, recipient domain, scrubbed error — never the address, never a secret. */
export function unloggedSendLine(template: string, recipient: string, error: unknown): string {
  return `[email] could not log send ${JSON.stringify({
    template,
    domain: recipientDomain(recipient),
    error: scrubEmailError(error),
  })}`;
}

export function reportUnloggedSend(template: string, recipient: string, error: unknown): void {
  try {
    console.error(unloggedSendLine(template, recipient, error));
  } catch {
    // The logging path must not throw, even when the console itself does.
  }
}

/**
 * Leave a retryable `failed` row for this attempt.
 *
 * `existingId` updates the row the claim already created, and only while it
 * is still queued or failed — a sent row keeps its sent_at. Without an id,
 * the row is inserted. A duplicate key means the row exists; that is not a
 * failure to log. Any other failure is reported and swallowed.
 */
export async function persistFailedSend(
  sink: EmailLogSink,
  spec: FailedSendSpec,
  error: unknown,
  existingId?: string,
): Promise<void> {
  const row: FailedEmailInsert = {
    template: spec.template,
    recipient: spec.to,
    status: 'failed',
    error: scrubEmailError(error),
    dedupe_key: spec.dedupeKey ?? null,
    user_id: spec.userId ?? null,
    entity_type: spec.entity?.type ?? null,
    entity_id: spec.entity?.id ?? null,
    next_attempt_at: new Date().toISOString(),
  };

  try {
    const result = existingId
      ? await sink.updateFailed(existingId, {
          status: 'failed',
          error: row.error,
          next_attempt_at: row.next_attempt_at,
        })
      : await sink.insertFailed(row);
    if (result?.error && result.error.code !== '23505') {
      reportUnloggedSend(spec.template, spec.to, result.error.message);
    }
  } catch (caught) {
    reportUnloggedSend(spec.template, spec.to, caught);
  }
}
