import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Whether a request carries the cron secret.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`, and the operator
 * uses the same bearer to read the detailed health report. Four routes
 * compared it with `!==`, which returns at the first byte that differs; the
 * health route compared it in constant time. One function, the constant-time
 * one, and a refusal outright when no secret is configured, so an unset
 * variable never turns into an open endpoint.
 */
export function isCronRequest(request: Request): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;

  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const given = Buffer.from(bearer, 'utf8');
  const expected = Buffer.from(secret, 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
