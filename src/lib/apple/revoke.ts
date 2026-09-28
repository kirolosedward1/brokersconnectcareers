import { createPrivateKey, sign } from 'node:crypto';

/**
 * Revoking an account's Sign in with Apple grant, as Apple requires of an app
 * that deletes an account made with it (App Store Review Guideline 5.1.1(v)).
 *
 * Deleting the Supabase user does not tell Apple anything: the app stays listed
 * under "Sign in with Apple" in the person's Apple ID until it is revoked. So
 * the iOS app asks Apple for a fresh authorization code just before deleting,
 * and the server trades it for a token and revokes that — the only way to hold
 * a revocable token, since Supabase keeps none.
 *
 * Server-side by construction: it needs the Sign in with Apple private key
 * (APPLE_PRIVATE_KEY, a .p8) and node:crypto, and only the account action
 * imports it. Nothing here is logged or returned but an outcome.
 */

export type AppleConfig = {
  /** The Apple Developer team, e.g. ABCDE12345. */
  teamId: string;
  /** The Sign in with Apple key's id. */
  keyId: string;
  /** The key itself, PEM (PKCS#8), as Apple issues it in a .p8 file. */
  privateKey: string;
  /** Who the code was issued to: the app's bundle id for a code from the iOS app. */
  clientId: string;
};

export type RevokeOutcome = 'revoked' | 'invalid_code' | 'unavailable' | 'not_configured';

const APPLE = 'https://appleid.apple.com';

/** The four settings, or null until all of them are set. */
export function appleConfigFromEnv(env: Record<string, string | undefined> = process.env): AppleConfig | null {
  const teamId = env.APPLE_TEAM_ID?.trim();
  const keyId = env.APPLE_KEY_ID?.trim();
  // Vercel stores a multi-line value with its newlines escaped.
  const privateKey = env.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  const clientId = env.APPLE_CLIENT_ID?.trim();
  if (!teamId || !keyId || !privateKey || !clientId) return null;
  if ([teamId, keyId, privateKey, clientId].some((value) => value.startsWith('REPLACE_ME'))) return null;
  return { teamId, keyId, privateKey, clientId };
}

const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

/**
 * The client secret Apple's token endpoints take: a JWT the team signs with its
 * key (ES256), naming the client it speaks for. Five minutes is all one
 * deletion needs.
 */
export function clientSecret(config: AppleConfig, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = { alg: 'ES256', kid: config.keyId };
  const payload = { iss: config.teamId, iat: nowSeconds, exp: nowSeconds + 300, aud: APPLE, sub: config.clientId };
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign('sha256', Buffer.from(input), {
    key: createPrivateKey(config.privateKey),
    // JWS wants r‖s, not the DER envelope node produces by default.
    dsaEncoding: 'ieee-p1363',
  });
  return `${input}.${base64url(signature)}`;
}

/**
 * Trade a fresh authorization code for a token and revoke it.
 *
 * `invalid_code`: Apple refused the code — expired (they last five minutes),
 * used, or issued to another client. The app asks the person to confirm with
 * Apple again. `unavailable`: Apple did not answer as expected; the caller
 * decides whether that stops the deletion.
 */
export async function revokeWithAuthorizationCode(
  code: string,
  config: AppleConfig | null = appleConfigFromEnv(),
  fetchImpl: typeof fetch = fetch,
): Promise<RevokeOutcome> {
  if (!config) return 'not_configured';

  try {
    const secret = clientSecret(config);
    const form = (fields: Record<string, string>) => ({
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(8000),
    });

    const exchanged = await fetchImpl(
      `${APPLE}/auth/token`,
      form({ client_id: config.clientId, client_secret: secret, code, grant_type: 'authorization_code' }),
    );
    if (!exchanged.ok) {
      const body = (await exchanged.json().catch(() => ({}))) as { error?: string };
      return exchanged.status === 400 && body.error === 'invalid_grant' ? 'invalid_code' : 'unavailable';
    }

    const tokens = (await exchanged.json()) as { refresh_token?: string; access_token?: string };
    const token = tokens.refresh_token ?? tokens.access_token;
    if (!token) return 'unavailable';

    const revoked = await fetchImpl(
      `${APPLE}/auth/revoke`,
      form({
        client_id: config.clientId,
        client_secret: secret,
        token,
        token_type_hint: tokens.refresh_token ? 'refresh_token' : 'access_token',
      }),
    );
    return revoked.ok ? 'revoked' : 'unavailable';
  } catch {
    // A timeout, a network failure, a key that does not parse.
    return 'unavailable';
  }
}
