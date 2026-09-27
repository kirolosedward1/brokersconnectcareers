import { createSign } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Google's Indexing API, for job pages only.
 *
 * Google documents this API for exactly two kinds of page, and a JobPosting
 * page is one of them. It is how a job board tells Google that a listing has
 * opened, changed or closed the same hour it happens, instead of waiting for
 * the next crawl — which on a young site can be weeks, long enough for a
 * closed role to keep drawing applicants from the job panel.
 *
 * Optional, and inert until configured. Set GOOGLE_INDEXING_CREDENTIALS to the
 * service account's JSON key (raw or base64), add that account as an Owner of
 * the property in Search Console, and every call below starts working. Unset,
 * each one returns 'disabled' without a network request.
 *
 * Never throws. A notification is a hint to a search engine and must not fail
 * a moderation, a close or the nightly cron.
 *
 * What is sent, and when:
 *   URL_UPDATED — a listing is approved, edited while live, closed, or
 *     expires. Closed and expired pages still answer 200, so "updated" is the
 *     honest word: Google recrawls, finds no JobPosting and a noindex, and
 *     drops it from the job panel.
 *   URL_DELETED — the page no longer exists for the public (a listing taken
 *     down by moderation or suspension, which row-level security hides).
 */

type Credentials = { client_email: string; private_key: string };
export type IndexingOutcome = 'sent' | 'disabled' | 'failed';

function credentials(): Credentials | null {
  const raw = process.env.GOOGLE_INDEXING_CREDENTIALS;
  if (!raw || raw.startsWith('REPLACE_ME')) return null;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(text) as Partial<Credentials>;
    return parsed.client_email && parsed.private_key
      ? { client_email: parsed.client_email, private_key: parsed.private_key }
      : null;
  } catch {
    console.warn('[indexing] GOOGLE_INDEXING_CREDENTIALS is set but is not a service account key');
    return null;
  }
}

const base64url = (value: string | Buffer) =>
  Buffer.from(value).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

let cached: { token: string; expires: number } | null = null;

async function accessToken(creds: Credentials): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: 'https://www.googleapis.com/auth/indexing',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${base64url(signer.sign(creds.private_key))}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`token ${response.status}`);

  const body = (await response.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

/** Absolute URL of a listing's canonical page. */
export function jobUrl(slug: string): string {
  return `${env.siteUrl}/jobs/${slug}`;
}

export async function notifyGoogle(
  url: string,
  type: 'URL_UPDATED' | 'URL_DELETED',
): Promise<IndexingOutcome> {
  const creds = credentials();
  if (!creds) return 'disabled';

  // A preview deployment or a local run must not tell Google about its URLs.
  if (!/^https:\/\//.test(url) || /localhost|vercel\.app/.test(new URL(url).hostname)) {
    return 'disabled';
  }

  try {
    const token = await accessToken(creds);
    const response = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url, type }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.warn(`[indexing] ${type} ${url} answered ${response.status}`);
      return 'failed';
    }
    return 'sent';
  } catch (error) {
    console.warn('[indexing] notification failed:', error instanceof Error ? error.message : error);
    return 'failed';
  }
}

/** Convenience for the common case: one listing by slug. */
export function notifyJobChanged(slug: string | null | undefined, type: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED') {
  return slug ? notifyGoogle(jobUrl(slug), type) : Promise.resolve<IndexingOutcome>('disabled');
}
