/**
 * One host in every URL we publish.
 *
 * The apex and www are the same site. Search treats them as two until one
 * redirects to the other, so the published origin is always www and the apex
 * is only a redirect (next.config.ts). Any other host — localhost, a preview,
 * a test double — is left exactly as it was configured.
 */
export const CANONICAL_HOST = 'www.brokersconnect.net';
export const APEX_HOST = 'brokersconnect.net';

export function canonicalSiteUrl(input: string): string {
  const trimmed = input.replace(/\/$/, '');
  try {
    const url = new URL(trimmed);
    if (url.hostname === APEX_HOST) {
      url.protocol = 'https:';
      url.hostname = CANONICAL_HOST;
      return url.toString().replace(/\/$/, '');
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}
