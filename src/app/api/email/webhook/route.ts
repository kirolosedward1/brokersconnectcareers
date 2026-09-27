import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifySvix } from '@/lib/email/svix';
import { eventKind } from '@/lib/email/events';
import { configuredValue } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Resend's delivery callback.
 *
 * This is the only thing in the system allowed to write `delivered`. Nothing
 * in the send path may claim it: the provider accepting a message and a mail
 * server accepting a message are different facts, and a dashboard that reports
 * the first as the second is a dashboard that lies to whoever is investigating
 * "الإيميل موصلنيش".
 *
 * Verify before acting, same rule as the payment callback. The URL will sit in
 * a provider dashboard and in logs, and the signature is the only thing
 * separating it from anyone who can send a POST. Without a configured secret
 * the endpoint refuses outright rather than trusting an unsigned body —
 * accepting would let anyone mark any message delivered, or suppress any
 * address on the platform, which is a denial-of-service against password
 * resets.
 *
 * A 503 is not free, though: Resend disables a webhook that keeps failing.
 * Production ran without the secret, answered 503 for a week, and the webhook
 * was switched off — so after setting RESEND_WEBHOOK_SECRET it has to be
 * re-enabled in the Resend dashboard as well. /api/health names the variable
 * when it is missing.
 *
 * Answer 200 to anything genuine, including events about messages this system
 * never sent. A provider that receives an error resends, and there is nothing
 * to fix by resending an event we have no row for.
 */

export async function POST(request: NextRequest) {
  const secret = configuredValue(process.env.RESEND_WEBHOOK_SECRET);

  // The raw bytes, because the signature is over what was sent — parsing and
  // re-serialising changes key order and whitespace.
  const raw = await request.text();

  if (!secret) {
    console.warn('[email] webhook rejected: RESEND_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const verified = verifySvix({
    secret,
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signatureHeader: request.headers.get('svix-signature'),
    body: raw,
  });

  if (!verified) {
    console.warn('[email] webhook rejected: signature did not verify');
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 });
  }

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'malformed' }, { status: 400 });
  }

  const parsed = eventKind(event);

  // Signed, so genuinely Resend — just not an event worth recording (opens,
  // clicks, contacts, domains, or `email.sent`, which the send path already
  // knows from the API response).
  if (!parsed) return NextResponse.json({ ok: true, ignored: true });

  // Verified above, so present.
  const eventId = request.headers.get('svix-id') as string;

  try {
    const admin = createAdminClient();
    /*
      One statement does all of it: the replay check on the event id, the
      forward-only status change, and any suppression — which follows only
      from an event that matched our own outbox, using the recipient we
      recorded rather than the one in the payload. This Resend account is
      shared with another site, and its complaints must not silence mail this
      platform sends.
    */
    const { data, error } = await admin.rpc('record_email_event', {
      p_event_id: eventId,
      p_provider_id: parsed.providerId,
      p_kind: parsed.kind,
    });
    if (error) throw new Error(`record_email_event: ${error.message}`, { cause: error });

    return NextResponse.json({ ok: true, ...(data ?? {}) });
  } catch (error) {
    // Ours, not theirs — worth a 500 so the provider retries. The event-id
    // ledger is in the same transaction, so the retry is not mistaken for a
    // duplicate.
    console.warn('[email] webhook could not record:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'unavailable' }, { status: 500 });
  }
}
