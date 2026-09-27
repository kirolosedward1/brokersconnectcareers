import 'server-only';
import { configuredValue } from '@/lib/env';

/**
 * Cloudflare Turnstile, verified where verification means something.
 *
 * A token the browser produced proves nothing until this server (or Supabase
 * Auth, which does the same call with the same secret) has asked Cloudflare
 * about it. This is that call. It is used by the server actions that guard an
 * anonymous or high-risk form; the sign-in, sign-up and reset forms hand their
 * token to Supabase Auth instead, which verifies it against the secret set in
 * the dashboard — so a script calling GoTrue directly meets the same wall.
 *
 * Off by default. With no secret configured, `turnstileConfigured()` is false,
 * the widget is not rendered, and verification is skipped — which is what a
 * fresh checkout and a preview deployment need. Production sets both keys.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function turnstileConfigured(): boolean {
  return Boolean(configuredValue(process.env.TURNSTILE_SECRET_KEY));
}

export type TurnstileOutcome = 'ok' | 'missing' | 'invalid' | 'unavailable';

export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<TurnstileOutcome> {
  const secret = configuredValue(process.env.TURNSTILE_SECRET_KEY);
  if (!secret) return 'ok';
  if (!token || token.length > 2048) return 'missing';

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return 'unavailable';
    const result = (await response.json()) as { success?: boolean };
    return result.success ? 'ok' : 'invalid';
  } catch {
    // Cloudflare unreachable is not the visitor's fault. The caller decides
    // whether to fail open (a low-risk form) or closed (a high-risk one).
    return 'unavailable';
  }
}
