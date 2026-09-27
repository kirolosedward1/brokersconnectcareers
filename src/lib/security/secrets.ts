import { timingSafeEqual } from 'node:crypto';

/**
 * Two secrets compared without leaking how far the comparison got.
 *
 * `===` returns at the first differing byte, which a patient caller with a
 * clock can turn into one byte of the secret at a time. Bounded, so an
 * attacker also cannot learn the length; and false rather than throwing when
 * either side is empty, which is what an unset variable arrives as.
 */
export function secretsMatch(presented: string | null | undefined, expected: string | null | undefined): boolean {
  if (!presented || !expected) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The bearer token on a request, or null. */
export function bearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1] : null;
}
