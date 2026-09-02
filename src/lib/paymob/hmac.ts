import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Paymob callback signature.
 *
 * Paymob signs a transaction callback by concatenating a fixed list of fields
 * — in this exact order, with no separator — and taking HMAC-SHA512 with the
 * account's HMAC secret. The order is theirs, not ours, and it is not
 * negotiable: a different order produces a different digest and every callback
 * is rejected.
 *
 * This is the only thing standing between the credit-granting endpoint and
 * anyone on the internet who can guess the URL, so it fails closed on anything
 * unexpected: a missing secret, a missing field, a malformed digest.
 */
const SIGNED_FIELDS = [
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parent_transaction',
  'id',
  'integration_id',
  'is_3d_secure',
  'is_auth',
  'is_capture',
  'is_refunded',
  'is_standalone_payment',
  'is_voided',
  'order.id',
  'owner',
  'source_data.pan',
  'source_data.sub_type',
  'source_data.type',
  'success',
] as const;

type Json = Record<string, unknown>;

/** `order.id` and `source_data.pan` are paths, not keys with dots in them. */
function at(object: Json, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value === null || typeof value !== 'object') return undefined;
    return (value as Json)[key];
  }, object);
}

/**
 * Booleans arrive as JSON `true`/`false` but are signed as the lowercase
 * strings Python's json.dumps produces, which is what Paymob's own examples
 * show. Numbers and strings are stringified as-is.
 */
function normalise(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return '';
  return String(value);
}

export function buildSignedPayload(transaction: Json): string {
  return SIGNED_FIELDS.map((field) => normalise(at(transaction, field))).join('');
}

export function computeHmac(transaction: Json, secret: string): string {
  return createHmac('sha512', secret).update(buildSignedPayload(transaction)).digest('hex');
}

/**
 * True only for a callback that really came from Paymob.
 *
 * Compared with timingSafeEqual rather than `===`: string comparison bails at
 * the first differing byte, which leaks how much of a guess was right and
 * turns forging a digest into a series of cheap questions.
 */
export function verifyHmac(transaction: Json, received: string | null, secret: string): boolean {
  if (!secret || !received) return false;

  const expected = computeHmac(transaction, secret);
  if (expected.length !== received.length) return false;

  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'));
  } catch {
    return false;
  }
}
