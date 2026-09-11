import 'server-only';

/**
 * What a failure leaves behind in the platform log.
 *
 * The rule is one line long and it is the whole point of this file: log the
 * identifiers, never the content. A job id, an application id, a template
 * name, a Postgres error code — those are what somebody reading the logs at
 * nine in the morning needs in order to find the row and the person. A name, a
 * WhatsApp number, a CV path, an email address or the text of anything a user
 * typed are what they need never to have.
 *
 * The identifiers are also the correlation: this product has no request id, and
 * inventing one would only be useful if something aggregated it. The entity a
 * failure happened to is the handle that actually joins a log line to a row in
 * the database and to a line in an employer's support message.
 */

type Detail = Record<string, string | number | boolean | null | undefined>;

/**
 * Addresses removed from text this app did not write.
 *
 * Resend's error bodies are genuinely diagnostic — "domain is not verified",
 * "invalid recipient" — and sometimes carry the recipient's address inside the
 * same sentence. The reason is worth keeping; the address is not, and the
 * email_log id beside it is a better handle anyway.
 */
export function withoutAddresses(text: string): string {
  return text.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<address>');
}

/**
 * One shape for every failure worth finding again.
 *
 * `area` is the subsystem, the way the existing `[email]` prefixes already
 * read. `event` is what did not happen, in the terms the product uses. The
 * rest is identifiers.
 */
export function logFailure(area: string, event: string, detail: Detail = {}): void {
  const pairs = Object.entries(detail)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');

  console.warn(`[${area}] ${event}${pairs ? ` ${pairs}` : ''}`);
}
