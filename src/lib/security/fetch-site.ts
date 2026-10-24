/**
 * Was this request started by another site?
 *
 * A GET that spends something (a contact reveal, a CV download, the day's
 * export) under the website's cookie can be started by any page on the
 * internet: SameSite=Lax sends the cookie with a top-level navigation, so
 * `location = 'https://www.brokersconnect.net/api/agent-cv/<handle>'` on a
 * hostile page used up a signed-in recruiter's allowance and wrote a reveal
 * the consultant sees in their ledger.
 *
 * Browsers say where a request came from in Sec-Fetch-Site, which a page
 * cannot set. `same-origin` is this site; `none` is the person typing the URL
 * or opening a bookmark. `same-site` is refused too: a sibling subdomain is a
 * different application (careers.brokersconnect.net is an older one). A
 * request with no header at all — the app with its bearer token, curl, an
 * old browser — is not a browser navigation another site can start, and is
 * judged by its credentials as before.
 */
export function startedByAnotherSite(headers: Headers): boolean {
  const site = headers.get('sec-fetch-site');
  return site === 'cross-site' || site === 'same-site';
}
