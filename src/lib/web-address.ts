/**
 * A web address as a person types it: the scheme is added when left off, so
 * "nilebrokers.com" is https://nilebrokers.com — which is what the server
 * keeps (safeHttpUrl, security/sanitize.ts, takes http(s) only; a bare
 * domain it refused). Empty is no address at all.
 *
 * Shared by the website's company and onboarding forms and the app's: the
 * app added the scheme and the website did not, so the same company page
 * took "nilebrokers.com" on the phone and refused it in the browser.
 */
export function webAddress(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
}
