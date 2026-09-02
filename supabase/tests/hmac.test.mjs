/**
 * Paymob callback signature checks.
 *
 * Not a database test, but it lives here because it is the same kind of thing
 * the other two files cover: a rule that has to hold or money goes wrong, and
 * that nobody would notice was broken by looking at the site.
 *
 * Run with: node supabase/tests/hmac.test.mjs
 */
import { createHmac } from 'node:crypto';
import { reporter } from './setup.mjs';
import { buildSignedPayload, computeHmac, verifyHmac } from '../../src/lib/paymob/hmac.ts';

const report = reporter();
const SECRET = 'test_hmac_secret';

/** A callback shaped the way Paymob sends them. */
function callback(overrides = {}) {
  return {
    amount_cents: 300000,
    created_at: '2026-09-02T10:00:00.000000',
    currency: 'EGP',
    error_occured: false,
    has_parent_transaction: false,
    id: 987654321,
    integration_id: 1234567,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: { id: 555444333, merchant_order_id: 'ord-1' },
    owner: 42,
    pending: false,
    source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
    success: true,
    ...overrides,
  };
}

report.section('the signed payload is built in Paymob’s field order');
{
  const payload = buildSignedPayload(callback());
  const expected =
    '300000' +
    '2026-09-02T10:00:00.000000' +
    'EGP' +
    'false' + // error_occured
    'false' + // has_parent_transaction
    '987654321' +
    '1234567' +
    'true' + // is_3d_secure
    'false' + // is_auth
    'false' + // is_capture
    'false' + // is_refunded
    'true' + // is_standalone_payment
    'false' + // is_voided
    '555444333' + // order.id
    '42' + // owner
    '2346' + // source_data.pan
    'MasterCard' +
    'card' +
    'true'; // success

  report.check('fields concatenate in the documented order', payload === expected, payload);
  // The boolean rendering on its own: signing `true` as "1" would produce a
  // digest that never matches Paymob's, and the failure would look like a
  // wrong secret rather than a wrong encoding.
  const allTrue = buildSignedPayload({
    ...callback(),
    error_occured: true,
    has_parent_transaction: true,
    is_auth: true,
    is_capture: true,
    is_refunded: true,
    is_voided: true,
  });
  const trues = allTrue.match(/true/g)?.length ?? 0;
  report.check('booleans render as "true"/"false", never 1/0', trues === 9 && !allTrue.includes('undefined'), `${trues} trues`);
}

report.section('a genuine callback verifies');
{
  const body = callback();
  const signature = createHmac('sha512', SECRET).update(buildSignedPayload(body)).digest('hex');

  report.check('our digest matches an independently computed one', computeHmac(body, SECRET) === signature);
  report.check('and verifies', verifyHmac(body, signature, SECRET) === true);
}

report.section('a tampered callback does not');
{
  const body = callback();
  const signature = computeHmac(body, SECRET);

  // The attack this exists to stop: flip a decline into a success.
  const flipped = { ...body, success: false };
  report.check('flipping success invalidates it', verifyHmac(flipped, signature, SECRET) === false);

  const inflated = { ...body, amount_cents: 1 };
  report.check('changing the amount invalidates it', verifyHmac(inflated, signature, SECRET) === false);

  const reordered = { ...body, order: { ...body.order, id: 999 } };
  report.check('changing the order id invalidates it', verifyHmac(reordered, signature, SECRET) === false);

  report.check('a wrong secret invalidates it', verifyHmac(body, signature, 'other_secret') === false);
}

report.section('it fails closed');
{
  const body = callback();
  const signature = computeHmac(body, SECRET);

  report.check('no signature is a rejection', verifyHmac(body, null, SECRET) === false);
  report.check('no secret is a rejection', verifyHmac(body, signature, '') === false);
  report.check('a short digest is a rejection', verifyHmac(body, 'abc', SECRET) === false);
  report.check(
    'a same-length wrong digest is a rejection',
    verifyHmac(body, 'f'.repeat(signature.length), SECRET) === false,
  );
}

process.exit(report.finish() ? 0 : 1);
