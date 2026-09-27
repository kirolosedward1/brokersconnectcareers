import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logFailure } from '@/lib/observe';

/**
 * The server's own counter, for the things only the server can see.
 *
 * Every limit on a *table* lives in the database, inside the trigger or the
 * function that does the writing, because a signed-in client can reach
 * PostgREST directly and a check that only the Next server makes is a check a
 * script can walk around. This is for the rest: a CV download, a data export,
 * an email lookup — actions that go through a route or a server action and
 * nowhere else.
 *
 * Backed by rate_limit_hit() (migration 306), a sliding window over the same
 * rate_limit_hits table that hit_rate_limit() (migration 68) writes, under the
 * same lock, so the two callers count as one and there is one table to watch.
 * Each call prunes its own bucket, so nothing needs sweeping. Postgres because
 * it is the store this platform already has and a second store is a second
 * thing to run; at ten thousand monthly users the counter is a rounding error.
 *
 * Fails open. A limiter that cannot reach its store must not take the site
 * down with it — an outage is a worse day than an unthrottled hour — but it
 * says so in the log, loudly, so an outage of the limiter is not silent.
 */

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window turns over; 0 when allowed. */
  retryAfterSeconds: number;
};

export type RateLimitPolicy = { windowSeconds: number; max: number };

export async function rateLimit(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
  const open: RateLimitDecision = { allowed: true, remaining: policy.max, retryAfterSeconds: 0 };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    logFailure('ratelimit', 'no service role; limiter is open', { key: keyFamily(key) });
    return open;
  }

  const { data, error } = await admin.rpc('rate_limit_hit', {
    p_key: key,
    p_window_seconds: policy.windowSeconds,
    p_max: policy.max,
  });

  if (error || !data?.[0]) {
    logFailure('ratelimit', 'counter unavailable; limiter is open', {
      key: keyFamily(key),
      code: error?.code,
    });
    return open;
  }

  const row = data[0];
  return {
    allowed: Boolean(row.allowed),
    remaining: Number(row.remaining ?? 0),
    retryAfterSeconds: Number(row.retry_after_seconds ?? 0),
  };
}

/**
 * The configured threshold for a server-side limit, or the default beside it.
 *
 * abuse_limits (migration 304) holds every threshold the database enforces;
 * the server's own limits read the same table so an admin tunes both in one
 * place. Cached per process for a minute — a limit is not a thing that needs
 * to change within the second.
 */
const policies = new Map<string, { at: number; policy: RateLimitPolicy }>();

export async function policyFor(key: string, fallback: RateLimitPolicy): Promise<RateLimitPolicy> {
  const cached = policies.get(key);
  if (cached && Date.now() - cached.at < 60_000) return cached.policy;

  let policy = fallback;
  try {
    const { data } = await createAdminClient()
      .from('abuse_limits')
      .select('window_seconds, max_hits')
      .eq('key', key)
      .maybeSingle();
    if (data) policy = { windowSeconds: data.window_seconds, max: data.max_hits };
  } catch {
    // No service role, or the table is unreachable: the default stands.
  }

  policies.set(key, { at: Date.now(), policy });
  return policy;
}

/** The part of a key before the subject, so a log names the rule and not the person. */
function keyFamily(key: string): string {
  return key.split(':').slice(0, 2).join(':');
}
