import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Svix webhook signatures, which is what Resend signs with.
 *
 * Written out rather than pulling in the svix package: this is one HMAC and a
 * timestamp check, and a dependency whose whole job is thirty lines of
 * node:crypto is a dependency to keep updated forever.
 *
 * The scheme, for the next person reading it:
 *
 *   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
 *   key            = base64-decode of the secret after the `whsec_` prefix
 *   header         = space-separated `v1,<base64 signature>` entries, because
 *                    a secret being rotated means two valid signatures at once
 *
 * No `server-only` marker, unlike the rest of this directory: the secret is an
 * argument rather than something this module reads, so it holds nothing worth
 * keeping out of a bundle — and being importable is what lets the test suite
 * exercise it directly.
 *
 * The raw body matters. Parsing and re-serialising changes key order and
 * whitespace, and the signature is over the bytes that were sent — so the
 * caller must hand over the exact string it read.
 */

/** Anything older than this is a replay, not a delivery. */
const TOLERANCE_SECONDS = 300;

export function verifySvix({
  secret,
  id,
  timestamp,
  signatureHeader,
  body,
  now = Date.now(),
}: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signatureHeader: string | null;
  body: string;
  now?: number;
}): boolean {
  if (!secret || !id || !timestamp || !signatureHeader) return false;

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return false;
  if (Math.abs(now / 1000 - sent) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  if (key.length === 0) return false;

  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`)
    .digest();

  // A rotating secret means the header can carry several; any one matching is
  // a valid signature. Every candidate is compared, without an early return,
  // so the number of comparisons does not depend on which one matched.
  let matched = false;
  for (const entry of signatureHeader.split(' ')) {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) continue;

    const candidate = Buffer.from(value, 'base64');
    if (candidate.length !== expected.length) continue;
    if (timingSafeEqual(candidate, expected)) matched = true;
  }

  return matched;
}
