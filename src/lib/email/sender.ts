/*
  No `server-only` marker: a pure check on a string, importable by the tests.
*/

/**
 * Why the configured sender must not be used in production, or null.
 *
 * `onboarding@resend.dev` is Resend's shared test sender: it only delivers to
 * the account owner, it cannot align with this domain's SPF/DKIM so DMARC
 * fails, and it is exactly what a copied quick-start leaves behind. Another
 * site on the same Resend account was found sending from it in production, so
 * this is checked rather than assumed. (A sender on an unverified domain is
 * caught by Resend itself, which answers 403.)
 */
export function senderProblem(from: string | null | undefined): string | null {
  if (!from) return null;
  const address = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  const domain = address.split('@')[1] ?? '';
  if (domain === 'resend.dev' || domain.endsWith('.resend.dev')) return 'test_sender';
  if (!domain.includes('.')) return 'malformed_sender';
  return null;
}
