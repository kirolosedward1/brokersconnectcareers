/**
 * The circumstances of a failure, reduced to what support needs.
 *
 * Two rules decide everything here. A path is kept and its query string is
 * not: the query is where this app carries OAuth codes, search terms, `next`
 * destinations and, on one route, a one-time sign-in code — so a route is only
 * ever its pathname. And a browser is described, not recorded: "Chrome 128 ·
 * Android · in-app Facebook" answers the questions support actually asks, while
 * a raw user-agent string is a fingerprint that answers none of them better.
 *
 * Isomorphic, like reference.ts: the server reads these off request headers,
 * the browser off `location` and `navigator`, and both must produce the same
 * shape for the rows to line up.
 */

/**
 * The pathname only, capped. Never the query, never the fragment.
 *
 * This shapes a log field; it never decides where anybody is sent — that is
 * safe-next.ts, alone, and the auth suite holds it to that by refusing a
 * hand-written "starts with a slash" test anywhere else. None is needed here:
 * the URL parser gives every http(s) address a pathname that begins with one,
 * which is the shape the column requires, and anything else has no path worth
 * keeping.
 */
export function routeOf(input: string | null | undefined): string | null {
  if (!input) return null;

  let url: URL;
  try {
    // A full URL (a Referer header) or a bare path (location.pathname) — both
    // parse against a throwaway base, and only the pathname survives.
    url = new URL(input, 'https://route.invalid');
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  let path = url.pathname;
  // Percent-encoded Arabic slugs are legible decoded, and support reads these.
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed encoding stays as it arrived.
  }
  return path.slice(0, 200);
}

/** Which language the reader was using, from where they were. */
export function localeOfRoute(route: string | null | undefined): 'ar' | 'en' {
  return route && /^\/en(\/|$)/.test(route) ? 'en' : 'ar';
}

/**
 * In-app browsers first, because they are the diagnosis.
 *
 * A confirmation link opened from inside Facebook, Instagram or the Gmail app
 * runs in that app's own browser, which does not share cookies with the one
 * the account was made in — so the sign-in code exchange finds no verifier and
 * fails. "The link doesn't work" is, more often than anything else, this.
 */
const IN_APP: [RegExp, string][] = [
  [/FBAN|FBAV|FB_IAB|FBIOS/i, 'Facebook'],
  [/Instagram/i, 'Instagram'],
  [/Messenger|MessengerForiOS/i, 'Messenger'],
  [/\bGSA\//i, 'Google app'],
  [/Snapchat/i, 'Snapchat'],
  [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'],
  [/\bLine\//i, 'LINE'],
  [/Twitter|TwitterAndroid/i, 'X'],
  [/LinkedInApp/i, 'LinkedIn'],
];

const BROWSERS: [RegExp, string][] = [
  [/EdgA?\/(\d+)|EdgiOS\/(\d+)/, 'Edge'],
  [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
  [/OPR\/(\d+)|OPiOS\/(\d+)/, 'Opera'],
  [/Firefox\/(\d+)|FxiOS\/(\d+)/, 'Firefox'],
  [/CriOS\/(\d+)/, 'Chrome'],
  [/Chrome\/(\d+)/, 'Chrome'],
  [/Version\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari\//, 'Safari'],
];

/**
 * "Chrome 128 · Android 14 · mobile", or null when there is nothing to say.
 *
 * Deliberately coarse. Major versions only, no device model, no build
 * numbers: enough to reproduce a problem, not enough to single anybody out.
 */
export function describeClient(userAgent: string | null | undefined): string | null {
  const ua = (userAgent ?? '').slice(0, 512);
  if (!ua) return null;

  const parts: string[] = [];

  let browser: string | null = null;
  for (const [pattern, name] of BROWSERS) {
    const match = ua.match(pattern);
    if (match) {
      const version = match.slice(1).find(Boolean);
      browser = version ? `${name} ${version}` : name;
      break;
    }
  }
  if (/; wv\)/.test(ua) && !browser?.startsWith('Samsung')) browser = 'Android WebView';
  parts.push(browser ?? 'Unknown browser');

  const android = ua.match(/Android (\d+)/);
  const ios = ua.match(/(?:iPhone|CPU) OS (\d+)/);
  if (android) parts.push(`Android ${android[1]}`);
  else if (/iPad/.test(ua)) parts.push(`iPadOS${ios ? ` ${ios[1]}` : ''}`);
  else if (ios) parts.push(`iOS ${ios[1]}`);
  else if (/Windows NT/.test(ua)) parts.push('Windows');
  else if (/Mac OS X/.test(ua)) parts.push('macOS');
  else if (/CrOS/.test(ua)) parts.push('ChromeOS');
  else if (/Linux/.test(ua)) parts.push('Linux');

  parts.push(/Mobi|iPhone|Android.*Mobile/.test(ua) ? 'mobile' : /iPad|Tablet|Android/.test(ua) ? 'tablet' : 'desktop');

  const app = IN_APP.find(([pattern]) => pattern.test(ua));
  if (app) parts.push(`in-app ${app[1]}`);

  return parts.join(' · ').slice(0, 120);
}

/**
 * Which build was running.
 *
 * Vercel exposes the commit to the server at runtime; the browser has no such
 * variable, so the server fills this in for every row, including the ones the
 * browser reports. "It started on Tuesday" becomes "it started with 3f2a9c1".
 */
export function releaseOf(env: Record<string, string | undefined>): string {
  return (
    env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
    env.VERCEL_DEPLOYMENT_ID?.slice(-8) ||
    'local'
  );
}

/**
 * Text this app did not write, made safe to keep.
 *
 * Database and provider messages are genuinely diagnostic, and occasionally
 * carry a value from the row they were refusing — an address in a Resend
 * error, a phone number in a constraint message. The reason is kept; the
 * values are not. Seven or more digits in a row is a phone number or an
 * account number, never the part of a message that explains anything.
 */
export function scrubbed(text: string | null | undefined, max = 200): string | null {
  if (!text) return null;
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<address>')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '<number>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
