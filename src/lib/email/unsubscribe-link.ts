/**
 * The two ways out of an optional email, made from one token and one kind.
 *
 *   page      what the footer link opens: the confirmation page, which asks
 *             before it changes anything, so a link scanner or a prefetch
 *             cannot turn somebody's emails off.
 *   oneClick  the List-Unsubscribe header's address (RFC 8058). A mail client's
 *             own "unsubscribe" button POSTs `List-Unsubscribe=One-Click` there
 *             and expects the change made then and there — /api/unsubscribe,
 *             which makes it. The header used to carry the page's address,
 *             which answers a POST by rendering itself: a 200, and nobody
 *             unsubscribed.
 *
 * Pure, so supabase/tests/email.test.mjs runs it under plain Node.
 */
export function unsubscribeLinks(siteUrl: string, token: string, kind: string): { page: string; oneClick: string } {
  const query = new URLSearchParams({ token, kind }).toString();
  return {
    page: `${siteUrl}/unsubscribe?${query}`,
    oneClick: `${siteUrl}/api/unsubscribe?${query}`,
  };
}
