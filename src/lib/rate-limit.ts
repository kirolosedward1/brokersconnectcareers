import 'server-only';
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * A counter for user-triggered actions that leave no row of their own.
 *
 * Backed by hit_rate_limit() (migration 68), which checks and counts in one
 * locked step. Buckets name an action and a subject — `reset:email:<hash>` —
 * and never carry an address in the clear: the table is a list of who asked
 * for what, and a hash answers "has this one asked too often" without it.
 *
 * Fails open. Every limit here sits in front of something that has a second
 * limit behind it (GoTrue's own email caps, the outbox's hourly ceiling), and
 * a database hiccup that locked everybody out of password reset would be a
 * worse outage than the abuse it prevents.
 */
export async function allow(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc('hit_rate_limit', {
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return data !== false;
  } catch (error) {
    console.warn('[rate-limit] check failed, allowing:', error instanceof Error ? error.message : error);
    return true;
  }
}

/** A stable, non-reversible handle for an address or other identifier. */
export function subject(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('base64url').slice(0, 22);
}

/**
 * The caller's address, as Vercel reports it. The first entry of
 * x-forwarded-for is the client; Vercel overwrites the header rather than
 * appending to one the client sent, so it cannot be spoofed from outside.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'unknown').trim();
}
