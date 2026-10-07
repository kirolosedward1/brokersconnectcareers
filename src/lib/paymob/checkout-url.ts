/**
 * Paymob's payment page: the one place outside this site the browser is sent
 * on purpose. The buy button checks the address its own server action handed
 * back before going there, as every other document navigation checks its path
 * (safe-next.ts) — a page that goes wherever a response says is one tampered
 * response away from an open redirect.
 *
 * Pure, and free of the server-only client beside it, so the button can
 * import it and scripts/security-libs.test.mjs can run it under plain Node.
 */
export const PAYMENT_ORIGIN = 'https://accept.paymob.com';

export function isPaymentPage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.origin === PAYMENT_ORIGIN && /^\/api\/acceptance\/iframes\/\d+$/.test(parsed.pathname);
}
