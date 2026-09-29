/**
 * Reading the mobile app's credential off a request.
 *
 * The app authenticates every call with the user's Supabase access token in an
 * `Authorization: Bearer` header. What this decides is only its shape: absent,
 * a token worth asking the auth server about, or something that is not one.
 * Whether the token is good is the auth server's answer, asked once per request
 * in http.ts.
 *
 * "Not one" is answered 401 without a round trip. That covers the publishable
 * key sent by mistake (not a JWT), a cron secret aimed at the wrong route, and
 * a header with a scheme other than Bearer. The app treats a 401 as "refresh
 * and retry once", so a malformed header costs it one refresh and then a clear
 * failure, never a loop.
 *
 * Pure, so the rules can be tested without a server.
 */
export type Bearer =
  | { kind: 'none' }
  | { kind: 'token'; token: string }
  | { kind: 'malformed' };

/** Three base64url segments, the last possibly empty — the shape of a JWT. */
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/** Supabase access tokens run to about a kilobyte; anything much longer is not one. */
const MAX_TOKEN_LENGTH = 8192;

export function readBearer(header: string | null | undefined): Bearer {
  if (header === null || header === undefined || header.trim() === '') return { kind: 'none' };

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return { kind: 'malformed' };

  const token = match[1];
  if (token.length > MAX_TOKEN_LENGTH || !JWT.test(token)) return { kind: 'malformed' };

  return { kind: 'token', token };
}

/** The `WWW-Authenticate` value for a 401, per RFC 6750. */
export function challenge(reason: 'unauthenticated' | 'invalid_token'): string {
  return reason === 'invalid_token' ? 'Bearer error="invalid_token"' : 'Bearer';
}
