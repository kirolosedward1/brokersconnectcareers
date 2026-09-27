'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { clientIp, hashSubject } from '@/lib/security/request';
import { rateLimit, policyFor } from '@/lib/security/rate-limit';
import { recordSecurityEvent } from '@/lib/security/events';

/**
 * What the sign-in form tells the server about how it went.
 *
 * Sign-in, sign-up and the reset request run in the browser against Supabase
 * Auth directly, so the server never sees them happen. That is the right
 * place for them — GoTrue's own per-address limits and its CAPTCHA check are
 * what a script meets when it skips this site altogether — but it leaves the
 * platform blind to a run of failures against one address, which is the one
 * thing an operator wants to see.
 *
 * So the form reports the outcome, and this records it: hashed address,
 * hashed client, kind. It also answers with how much friction the form should
 * show next — a pause, and then the challenge widget shown rather than
 * invisible — which is a courtesy to the honest person who mistyped twice and
 * a nuisance to a script, and enforces nothing on its own. The report itself
 * is limited per client so it cannot be used to flood the log.
 */

const schema = z.object({
  kind: z.enum(['sign_in_failed', 'sign_up_failed', 'reset_requested', 'sign_in_locked_out']),
  email: z.string().trim().email().max(254).optional(),
});

export type AuthFriction = { pause: number; challenge: boolean };

const NONE: AuthFriction = { pause: 0, challenge: false };

export async function reportAuthOutcome(input: unknown): Promise<AuthFriction> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return NONE;

  const ip = clientIp(await headers());
  const ipHash = ip ? hashSubject('ip', ip) : null;
  const emailHash = parsed.data.email ? hashSubject('email', parsed.data.email) : null;

  // The report channel itself is bounded.
  if (ipHash) {
    const policy = await policyFor('auth_report:ip:hour', { windowSeconds: 3600, max: 120 });
    const allowed = await rateLimit(`auth_report:${ipHash}`, policy);
    if (!allowed.allowed) return NONE;
  }

  void recordSecurityEvent(`auth.${parsed.data.kind}`, {
    severity: parsed.data.kind === 'sign_in_locked_out' ? 'warning' : 'info',
    subject: ipHash,
    metadata: emailHash ? { email: emailHash } : {},
  });

  if (parsed.data.kind !== 'sign_in_failed') return NONE;

  // Failures in the last fifteen minutes, by client and by address. Either
  // running hot earns the pause; both earn the visible challenge.
  const window = { windowSeconds: 900, max: 4 };
  const [byIp, byEmail] = await Promise.all([
    ipHash ? rateLimit(`auth_fail:${ipHash}`, window) : Promise.resolve(null),
    emailHash ? rateLimit(`auth_fail:${emailHash}`, window) : Promise.resolve(null),
  ]);

  const ipHot = byIp ? !byIp.allowed : false;
  const emailHot = byEmail ? !byEmail.allowed : false;
  const used = Math.max(
    byIp ? window.max - byIp.remaining : 0,
    byEmail ? window.max - byEmail.remaining : 0,
  );

  if (ipHot && emailHot) {
    void recordSecurityEvent('auth.sign_in_locked_out', {
      severity: 'warning',
      subject: ipHash,
      metadata: emailHash ? { email: emailHash } : {},
    });
  }

  return {
    pause: Math.min(10, Math.max(0, used - 1) * 2),
    challenge: ipHot || emailHot,
  };
}
