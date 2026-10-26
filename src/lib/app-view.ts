/**
 * Whether the results-page app card should stay hidden for this browser.
 *
 * The mobile app opens website pages with the system browser and the plain
 * URL (mobile `WebBrowser.openBrowserAsync`). It sends no user-agent token,
 * no extra header, and no query flag, so none of those can be matched here.
 *
 * `?app=1` is the flag the site itself understands. The first page that sees
 * it writes a session cookie, and later pages in the same browser session
 * stay hidden after the query is gone. A generic Android WebView (`wv`) is
 * not this flag: other apps' browsers send that too.
 */

/** Session cookie. No expiry: it lasts until the browser session ends. */
export const APP_VIEW_COOKIE = 'bc_app';

const QUERY = 'app';

/** `?app=1`, wherever it sits in the query. `app=10` and `App=1` do not count. */
export function searchHidesAppPromo(search: string | null | undefined): boolean {
  const raw = (search ?? '').replace(/^\?/, '');
  if (!raw) return false;
  return new URLSearchParams(raw).get(QUERY) === '1';
}

/**
 * The session cookie, as `document.cookie` or a Cookie header would present it.
 * The pair has to be the whole entry, so a different cookie that merely
 * contains the name does not hide the card.
 */
export function cookieHidesAppPromo(cookieHeader: string | null | undefined): boolean {
  const header = cookieHeader ?? '';
  if (!header) return false;
  const pair = `${APP_VIEW_COOKIE}=1`;
  return header.split(';').some((part) => part.trim() === pair);
}

/** True when this address, or an earlier one in the session, asked to hide the card. */
export function hidesAppPromo(input: {
  search?: string | null;
  cookie?: string | null;
}): boolean {
  return searchHidesAppPromo(input.search) || cookieHidesAppPromo(input.cookie);
}

/** The assignment `document.cookie` writes. Secure only on https. */
export function appViewCookieAssignment(secure: boolean): string {
  return `${APP_VIEW_COOKIE}=1; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/**
 * Writes the session cookie when this address carries `?app=1`.
 * Returns whether it wrote, so the caller can tell a card that is already
 * on screen to hide itself.
 */
export function persistAppView(
  loc: { search: string; protocol: string },
  writeCookie: (value: string) => void,
): boolean {
  if (!searchHidesAppPromo(loc.search)) return false;
  writeCookie(appViewCookieAssignment(loc.protocol === 'https:'));
  return true;
}

/** Browser only. The one place this cookie is written. */
export function writeAppViewCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return persistAppView(
    { search: window.location.search, protocol: window.location.protocol },
    (value) => {
      document.cookie = value;
    },
  );
}
