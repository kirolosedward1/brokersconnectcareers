import 'server-only';
import { createHash } from 'node:crypto';

/**
 * Who is asking, without keeping who is asking.
 *
 * Every limit and every security event needs a handle on the client — an IP
 * address, an email address — and none of them needs the value itself. A log
 * that is a list of addresses is a second breach waiting inside the first, so
 * the handle is a salted hash: enough to see that fifty events share a source,
 * not enough to say which source from the table alone.
 *
 * The salt is a deployment secret rather than a constant, so two deployments
 * (staging, production) do not produce comparable hashes, and a leaked table
 * cannot be joined against a rainbow of common addresses.
 */

function salt(): string {
  return (
    process.env.SECURITY_SALT ||
    process.env.CRON_SECRET ||
    // Production cannot run without the service role key, so a deployment
    // that set neither of the two above still hashes with a secret rather
    // than with the public string below. The hash reveals nothing of it.
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    // Development only. Production is expected to set SECURITY_SALT; the
    // health endpoint says when it has not.
    'brokers-connect-development-salt'
  );
}

/**
 * The same handle for a rate-limit bucket (`reset:email:<handle>`): salted,
 * so a copy of rate_limit_hits cannot be reversed by hashing every IPv4
 * address, or a list of email addresses, and looking the results up.
 */
export function bucketHandle(kind: 'ip' | 'email', value: string): string {
  return hashSubject(kind, value).slice(kind.length + 1, kind.length + 1 + 22);
}

/** A short, stable, non-reversible handle for a subject. */
export function hashSubject(kind: 'ip' | 'email' | 'user', value: string): string {
  const normalised = kind === 'email' ? value.trim().toLowerCase() : value.trim();
  return `${kind}:${createHash('sha256').update(`${salt()}|${kind}|${normalised}`).digest('hex').slice(0, 32)}`;
}

/**
 * The client's address, as the platform in front of us reports it.
 *
 * Vercel sets `x-real-ip` from the connection it terminated, and puts the
 * chain it saw in `x-forwarded-for`, first hop first. Only the first hop is
 * read from the chain: anything after it is what the client claims. Behind a
 * different edge the header names may differ; this never trusts a header the
 * client can set on its own, which means it can also be empty, and every
 * caller has to cope with "unknown".
 */
export function clientIp(headers: Headers): string | null {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  return null;
}

/** The `Retry-After` header value: whole seconds, never below one. */
export function retryAfter(seconds: number | null | undefined): string {
  return String(Math.max(1, Math.ceil(seconds ?? 1)));
}
