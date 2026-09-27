'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { allow, clientIp, subject } from '@/lib/rate-limit';

/**
 * The two auth emails a signed-out visitor can ask for, asked through the
 * server so they can be counted.
 *
 * GoTrue sends both and has its own limits, but those are project-wide and per
 * address; nothing stopped one visitor walking a list of other people's
 * addresses through "forgot password" and filling their inboxes with resets
 * from our domain — which is how a sender becomes a relay for harassment, and
 * how its reputation goes. These add a per-address and a per-IP cap in front.
 *
 * Called from the browser forms, running on the server: the PKCE verifier is
 * written as a cookie by the server client exactly as the browser client would
 * have, so /auth/callback exchanges the code the same way it always did.
 */

const emailSchema = z.string().trim().email().max(320);

type Result = { ok: true } | { ok: false; error: 'wait' | 'invalid' };

/**
 * A reset link, or the same answer when there is no account.
 *
 * The limit counts attempts whether or not the address exists, and GoTrue's
 * own errors are swallowed, so neither the success message nor a refusal can
 * tell anybody which addresses are registered. The only thing a refusal says
 * is "you have asked a lot", which was true of the asker, not the address.
 */
export async function requestPasswordReset(email: unknown): Promise<Result> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const address = subject(parsed.data);
  const ip = subject(await clientIp());

  // Three an hour to one address; twenty an hour from one network, which
  // leaves room for an office sharing an address and none for a list.
  if (!(await allow(`reset:email:${address}`, 3, 3600))) return { ok: false, error: 'wait' };
  if (!(await allow(`reset:ip:${ip}`, 20, 3600))) return { ok: false, error: 'wait' };

  try {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${env.siteUrl}/auth/callback?next=/sign-in/new-password`,
    });
  } catch {
    // Deliberately silent; see above.
  }
  return { ok: true };
}

/**
 * Another confirmation link for an account that has just signed up.
 *
 * The person already knows the address has an account — they created it on
 * the previous screen — so an error here can be reported as "wait".
 */
export async function resendConfirmation(email: unknown, redirectTo: string): Promise<Result> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  if (!(await allow(`confirm:email:${subject(parsed.data)}`, 3, 3600))) return { ok: false, error: 'wait' };
  if (!(await allow(`confirm:ip:${subject(await clientIp())}`, 20, 3600))) return { ok: false, error: 'wait' };

  // Only ever back to this site's own callback: the value comes from the
  // browser, and GoTrue's allow-list is the second check, not the only one.
  const site = new URL(env.siteUrl);
  let target: URL;
  try {
    target = new URL(redirectTo, site);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (target.origin !== site.origin || target.pathname !== '/auth/callback') {
    target = new URL('/auth/callback', site);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: parsed.data,
    options: { emailRedirectTo: target.toString() },
  });
  return error ? { ok: false, error: 'wait' } : { ok: true };
}
