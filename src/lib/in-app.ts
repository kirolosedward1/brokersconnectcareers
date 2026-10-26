/**
 * Whether this visit is the mobile app, for Google One Tap.
 *
 * Either signal is enough:
 *
 * - The app marker: `?app=1` on the address, or the session cookie `bc_app=1`.
 *   The value is exactly `1`. `app=10`, `App=1`, and a cookie whose name only
 *   contains `bc_app` do not count. The cookie pair has to be the whole entry.
 *   This is the same name and the same parameter the results-page app card
 *   uses. This file does not write the cookie.
 * - The embedded WebView: `window.ReactNativeWebView`, the Android `; wv)`
 *   token, or an iOS WKWebView with no `Safari/` token.
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
 * contains the name does not count.
 */
export function cookieHidesAppPromo(cookieHeader: string | null | undefined): boolean {
  const header = cookieHeader ?? '';
  if (!header) return false;
  const pair = `${APP_VIEW_COOKIE}=1`;
  return header.split(';').some((part) => part.trim() === pair);
}

/** True when this address, or an earlier one in the session, carries the app marker. */
export function hidesAppPromo(input: { search?: string | null; cookie?: string | null }): boolean {
  return searchHidesAppPromo(input.search) || cookieHidesAppPromo(input.cookie);
}

/**
 * The mobile app's embedded WebView, and only that.
 *
 * The app loads the website inside `react-native-webview` in one place:
 * `mobile/src/features/auth/captcha.tsx` (Turnstile). The app sets neither
 * `userAgent` nor `applicationNameForUserAgent`, so the WebView is recognised
 * by the two signals it already sends:
 *
 * - The flag. react-native-webview injects `window.ReactNativeWebView` before
 *   page scripts run. The captcha page already posts through it
 *   (`src/app/api/mobile/v1/captcha/route.ts`).
 * - The user agent. On Android the system WebView token is `; wv)` — the same
 *   token `describeClient` already reads as an Android WebView. On iOS the
 *   library's default is a bare WKWebView: an iPhone or iPad, AppleWebKit,
 *   and no `Safari/` token. Mobile Safari, Chrome (`CriOS`) and Firefox
 *   (`FxiOS`) all include `Safari/`, so they are not matched.
 *
 * `expo-web-browser` (the in-app browser Account uses for the site, the
 * policies and licences) is SFSafariViewController or a Chrome Custom Tab.
 * Its user agent is the system browser's and it does not inject
 * `ReactNativeWebView`, so it is not this WebView.
 */
export function isAppWebView(input: { userAgent?: string | null; reactNativeWebView?: boolean }): boolean {
  if (input.reactNativeWebView) return true;
  const ua = input.userAgent ?? '';
  if (/; wv\)/.test(ua)) return true;
  return /iPhone|iPad|iPod/.test(ua) && /AppleWebKit/.test(ua) && !/Safari\//.test(ua);
}

/**
 * One Tap stays hidden when the app marker is set or the page is inside the
 * app WebView. `webView` is the already-computed WebView flag.
 */
export function isInApp(input: {
  search?: string | null;
  cookie?: string | null;
  userAgent?: string | null;
  reactNativeWebView?: boolean;
  webView?: boolean;
}): boolean {
  if (input.webView) return true;
  if (hidesAppPromo(input)) return true;
  return isAppWebView(input);
}
