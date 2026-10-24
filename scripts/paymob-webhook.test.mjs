/**
 * The Paymob callback refuses whatever it cannot verify, the template's
 * REPLACE_ME placeholder included.
 *
 *   pnpm test:paymob-webhook
 *
 * The callback grants paid credits. .env.vercel.local ships every secret as a
 * REPLACE_ME placeholder, so a placeholder imported unedited is a secret
 * anyone who reads the template knows: a callback signed with it must be
 * refused as unconfigured, as the cron routes and the email webhook already
 * do (configuredValue in src/lib/env.ts). The route is loaded under Node with
 * the admin client faked (scripts/email-harness), so a refused call never
 * reaches a database.
 */
const { computeHmac } = await import('../src/lib/paymob/hmac.ts');

let pass = 0;
let fail = 0;
function is(label, got, want) {
  if (got === want) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label} — got ${got}, want ${want}`);
  }
}

globalThis.__db = { orders: [] };
const { POST } = await import('../src/app/api/paymob/webhook/route.ts');
const { NextRequest } = await import('next/server.js');

const transaction = {
  id: 1,
  amount_cents: 50000,
  currency: 'EGP',
  success: true,
  pending: false,
  is_refunded: false,
  is_voided: false,
  order: { id: 77, merchant_order_id: 'bc-order-1' },
};

function call(signedWith) {
  const hmac = computeHmac(transaction, signedWith);
  return POST(
    new NextRequest(`https://www.brokersconnect.net/api/paymob/webhook?hmac=${hmac}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ obj: transaction }),
    }),
  );
}

console.log('— a secret that is not configured');
{
  delete process.env.PAYMOB_HMAC_SECRET;
  is('unset: refused as not configured', (await call('anything')).status, 503);

  process.env.PAYMOB_HMAC_SECRET = 'REPLACE_ME_paymob_hmac';
  is('the REPLACE_ME placeholder, signed with it: refused as not configured', (await call('REPLACE_ME_paymob_hmac')).status, 503);
}

console.log('— a configured secret');
{
  process.env.PAYMOB_HMAC_SECRET = 'a-real-secret-from-the-paymob-dashboard';
  is('signed with something else: refused', (await call('REPLACE_ME_paymob_hmac')).status, 401);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
