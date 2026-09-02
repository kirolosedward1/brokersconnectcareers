import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyHmac } from '@/lib/paymob/hmac';

export const dynamic = 'force-dynamic';

/**
 * Paymob's transaction callback.
 *
 * Two rules govern everything here.
 *
 * Verify before acting. This endpoint grants paid credits, and its URL will be
 * sitting in a dashboard and in logs. The HMAC is the only thing separating it
 * from anyone who can send a POST, so an unsigned or wrongly signed body is
 * rejected before the order id is even read.
 *
 * Answer 200 to anything genuine. A provider that receives an error resends,
 * and a resend of a payment we have already settled is exactly the event that
 * would grant a second pack of credits if the database were not refusing it.
 * So "we already did this" is a success, not a conflict — the only non-200s
 * here are a bad signature, an unparseable body, and a failure that is ours.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.PAYMOB_HMAC_SECRET;

  let body: { obj?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'malformed' }, { status: 400 });
  }

  const transaction = body?.obj;
  if (!transaction || typeof transaction !== 'object') {
    return NextResponse.json({ error: 'malformed' }, { status: 400 });
  }

  // Paymob puts the digest on the query string of the callback URL.
  const received = request.nextUrl.searchParams.get('hmac');

  if (!secret) {
    // Refusing is the only safe answer: with no secret there is no way to tell
    // a real callback from a forged one, and accepting would mean minting
    // credits for anyone who found the URL.
    console.warn('[paymob] callback rejected: PAYMOB_HMAC_SECRET is not configured');
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  if (!verifyHmac(transaction, received, secret)) {
    console.warn('[paymob] callback rejected: signature did not verify');
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 });
  }

  const order = transaction.order as { id?: number; merchant_order_id?: string } | undefined;
  const merchantOrderId = order?.merchant_order_id;
  const paymobOrderId = order?.id != null ? String(order.id) : null;
  const success = transaction.success === true;

  if (!merchantOrderId) {
    // Signed, so it is genuinely Paymob — but not about an order of ours.
    // Nothing to do, and nothing to retry.
    return NextResponse.json({ ok: true, outcome: 'no_merchant_order' });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // Retrying is the right behaviour here: the payment is real and our
    // configuration is the thing that is broken.
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const { data, error } = await admin.rpc('settle_order', {
    p_order_id: merchantOrderId,
    p_paymob_order_id: paymobOrderId,
    p_success: success,
  });

  if (error) {
    console.error('[paymob] settle_order failed:', error.message);
    // A 5xx asks Paymob to try again, which is what we want when the failure
    // is ours rather than theirs.
    return NextResponse.json({ error: 'settle_failed' }, { status: 500 });
  }

  console.info(`[paymob] order ${merchantOrderId}: ${data}`);
  return NextResponse.json({ ok: true, outcome: data });
}
