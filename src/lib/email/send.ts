import 'server-only';
import { withoutAddresses } from '@/lib/observe';
import { configuredValue } from '@/lib/env';

/**
 * The provider transport. One POST, and nothing above this layer knows the
 * provider's name.
 *
 * Resend over its REST API rather than its SDK: sending an email is one POST
 * with a JSON body, and the SDK would add a dependency, a bundle and a release
 * cadence to track in exchange for wrapping `fetch`.
 *
 * Nothing here throws. Email is a side effect of an action, never the point of
 * it — a candidate's application must be recorded whether or not the
 * employer's notification goes out.
 *
 * This layer does not decide *whether* to send, does not deduplicate and does
 * not log to the database. That is service.ts, which is the only thing that
 * should call this.
 */

const ENDPOINT = 'https://api.resend.com/emails';

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * RFC 8058 one-click unsubscribe. Gmail and Outlook render their own
   * unsubscribe control from these headers, and bulk senders that omit them
   * get filtered harder. The URL must accept POST.
   *
   * Absent on transactional mail — a password reset carries no unsubscribe,
   * because there is nothing to unsubscribe from.
   */
  unsubscribeUrl?: string;
};

export type SendOutcome = 'sent' | 'skipped' | 'failed';

export type SendResult = {
  outcome: SendOutcome;
  /** Resend's id for the message. The webhook arrives knowing only this. */
  providerId?: string;
  error?: string;
  /**
   * Whether trying again could plausibly work. A 422 for a malformed address
   * will fail identically forever; a 429 or a 502 will not.
   */
  retryable?: boolean;
};

/**
 * The sender, from configuration.
 *
 * RESEND_FROM carries the whole `Name <address>` form so the display name is
 * configurable too, rather than being spelled into a template somewhere.
 */
export function configuredSender(): string | null {
  return configuredValue(process.env.RESEND_FROM) ?? null;
}

export function emailConfigured(): boolean {
  return Boolean(configuredValue(process.env.RESEND_API_KEY) && configuredSender());
}

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  // configuredValue, not the raw variable: an unedited REPLACE_ME from the
  // import file would otherwise be sent to Resend as a bearer token and come
  // back 401, logged as a send failure rather than as "not set up yet".
  const key = configuredValue(process.env.RESEND_API_KEY);
  const from = configuredSender();

  if (!key || !from) {
    console.warn(`[email] not configured; skipped "${message.subject}"`);
    return { outcome: 'skipped', error: 'not_configured' };
  }

  const headers: Record<string, string> = {};
  if (message.unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${message.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(Object.keys(headers).length ? { headers } : {}),
      }),
    });

    if (!response.ok) {
      // Read the body: Resend puts the actual reason (unverified domain,
      // invalid recipient) in it, and the status alone is not diagnosable.
      const detail = await response.text().catch(() => '<unreadable>');
      /*
        The reason, without the recipient.

        Resend puts the actual cause in the body — an unverified domain, a
        rejected address — and sometimes the address itself in the same
        sentence. The cause is what makes this diagnosable; the address is
        contact data, and the email_log row this belongs to is a better handle
        for finding the person anyway.
      */
      console.warn(
        `[email] send failed (${response.status}) for "${message.subject}": ${withoutAddresses(detail)}`,
      );
      return {
        outcome: 'failed',
        error: `${response.status}: ${detail}`.slice(0, 500),
        // 4xx is the request being wrong and will stay wrong — except 408 and
        // 429, which are about timing. Everything else is worth another go.
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      };
    }

    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { outcome: 'sent', providerId: body?.id };
  } catch (error) {
    // A network failure, not a refusal.
    const message_ = error instanceof Error ? error.message : String(error);
    console.warn(`[email] send threw for "${message.subject}":`, message_);
    return { outcome: 'failed', error: message_.slice(0, 500), retryable: true };
  }
}
