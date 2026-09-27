/**
 * What a Resend webhook event means for the outbox.
 *
 * Kept apart from the route so the parsing — the part that decides whether an
 * address is suppressed forever — can be tested without a server.
 *
 * Bounce type matters. Resend reports `data.bounce.type` as "Permanent",
 * "Transient" or "Undetermined". Only a permanent bounce proves the address
 * does not exist; a transient one is a full mailbox or a greylisting server,
 * and suppressing on it would lock a person out of their own password notices
 * because their inbox was full on a Tuesday. Undetermined, or a payload with no
 * bounce detail at all, is treated as permanent: Resend documents
 * `email.bounced` as a permanent rejection, and guessing "temporary" about a
 * dead address costs sender reputation shared by every message on the domain.
 *
 * No `server-only` marker: pure, and imported by the tests.
 */

export type EventKind =
  | 'delivered'
  | 'bounced_hard'
  | 'bounced_soft'
  | 'complained'
  | 'failed'
  | 'suppressed'
  | 'delayed';

type Payload = {
  type?: unknown;
  data?: { email_id?: unknown; bounce?: { type?: unknown } | null } | null;
};

export function eventKind(event: unknown): { kind: EventKind; providerId: string } | null {
  if (!event || typeof event !== 'object') return null;
  const { type, data } = event as Payload;
  const providerId = typeof data?.email_id === 'string' ? data.email_id : null;
  if (typeof type !== 'string' || !providerId) return null;

  switch (type) {
    case 'email.delivered':
      return { kind: 'delivered', providerId };
    case 'email.bounced': {
      const bounce = String(data?.bounce?.type ?? '').toLowerCase();
      return { kind: bounce === 'transient' ? 'bounced_soft' : 'bounced_hard', providerId };
    }
    case 'email.complained':
      return { kind: 'complained', providerId };
    case 'email.failed':
      return { kind: 'failed', providerId };
    case 'email.suppressed':
      return { kind: 'suppressed', providerId };
    case 'email.delivery_delayed':
      return { kind: 'delayed', providerId };
    default:
      return null;
  }
}
