import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifySvix } from '@/lib/email/svix';
import { suppress } from '@/lib/email/service';
import type { EmailStatus } from '@/lib/supabase/database.types';

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
 * Answer 200 to anything genuine, including events about messages this system
 * never sent. A provider that receives an error resends, and there is nothing
 * to fix by resending an event we have no row for.
 */

/** Only the events that change what we know. Opens and clicks are not tracked. */
const STATUS_FOR: Record<string, EmailStatus> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.delivery_delayed': 'sent',
};

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;

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

  let event: { type?: string; data?: { email_id?: string; to?: string[] | string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'malformed' }, { status: 400 });
  }

  const status = event.type ? STATUS_FOR[event.type] : undefined;
  const providerId = event.data?.email_id;

  // Signed, so genuinely Resend — just not an event worth recording.
  if (!status || !providerId) return NextResponse.json({ ok: true, ignored: true });

  let matched = 0;
  try {
    const admin = createAdminClient();
    /*
      Read, because `matched = data ?? 0` turned a failed write into a
      successful webhook: the provider gets a 200, stops retrying, and the
      delivery status is never recorded. The catch below already knows a 500
      is the right answer when the failure is ours — it just never saw this
      one, because the RPC returns its error rather than throwing it.
    */
    const { data, error } = await admin.rpc('mark_email_delivered', {
      p_provider_id: providerId,
      p_status: status,
    });
    if (error) throw new Error(`mark_email_delivered: ${error.message}`, { cause: error });

    matched = data ?? 0;
  } catch (error) {
    // Ours, not theirs — worth a 500 so the provider retries.
    console.warn('[email] webhook could not record:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'unavailable' }, { status: 500 });
  }

  // A hard bounce means the address does not exist, and continuing to send to
  // it damages a reputation shared by every message this domain sends — one
  // dead address in a digest can push password resets into spam for everybody.
  // A complaint means they asked, in the strongest way the medium allows.
  //
  // Delivery delays are deliberately not suppressed: those are temporary, and
  // the outbox's attempt limit already bounds them.
  if (status === 'bounced' || status === 'complained') {
    const to = event.data?.to;
    const address = Array.isArray(to) ? to[0] : to;
    if (address) await suppress(address, status === 'bounced' ? 'hard_bounce' : 'complaint');
  }

  return NextResponse.json({ ok: true, matched });
}
