import 'server-only';

/**
 * Resend, over its REST API rather than its SDK.
 *
 * Sending an email is one POST with a JSON body. The SDK would add a
 * dependency, a bundle, and a release cadence to track, in exchange for
 * wrapping `fetch`.
 *
 * Nothing in here throws. Email is a side effect of an action, never the
 * point of it: a candidate's application must be recorded whether or not the
 * employer's notification goes out, and an unconfigured RESEND_API_KEY — which
 * is the state of every environment right now — must not turn applying to a
 * job into an error.
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
   */
  unsubscribeUrl?: string;
};

export type SendOutcome = 'sent' | 'skipped' | 'failed';

export async function sendEmail(message: EmailMessage): Promise<SendOutcome> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!key || !from) {
    console.warn(`[email] not configured; skipped "${message.subject}"`);
    return 'skipped';
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
      console.warn(
        `[email] send failed (${response.status}) for "${message.subject}": ${await response
          .text()
          .catch(() => '<unreadable>')}`,
      );
      return 'failed';
    }

    return 'sent';
  } catch (error) {
    console.warn(
      `[email] send threw for "${message.subject}":`,
      error instanceof Error ? error.message : error,
    );
    return 'failed';
  }
}
