/**
 * Website addresses as app paths.
 *
 * The app's routes mirror the website's paths — /jobs, /jobs/<slug>,
 * /companies/<slug> — so a universal link, a notification's `href` and a push
 * tap all name a screen the same way the site names a page. What differs is
 * only the wrapping: a full URL instead of a path, the /en prefix English
 * pages carry, and the `?src=share` tag the share button adds (which only the
 * website counts).
 *
 * Anything not on the site's own hosts, or not a web address at all, goes
 * home rather than anywhere it names. Pure; tests/links.test.ts.
 *
 * A link from outside the app also says which tab it opens in (inOwnTab): a
 * listing is shown in the Jobs tab with the board under it, a company in the
 * Companies tab over the directory. Inside the app the same paths stay in
 * whichever tab the reader is using, which is expo-router's default.
 */

const SITE = 'https://www.brokersconnect.net';
const SITE_HOSTS = new Set(['www.brokersconnect.net', 'brokersconnect.net']);
const APP_SCHEME = 'brokersconnect:';

/** Locale prefixes the website's `localePrefix: 'as-needed'` can put in front of a path. */
const LOCALE_PREFIX = /^\/(en|ar)(?=\/|$)/;

/** Parameters that belong to the website's analytics, not to the screen. */
const DROPPED_PARAMS = ['src'];

export function webPathToAppPath(input: string): string {
  let url: URL;
  try {
    // A bare path is read against the site, so both forms go through one parser.
    url = new URL(input, SITE);
  } catch {
    return '/';
  }

  if (url.protocol === APP_SCHEME) {
    // brokersconnect://jobs/abc parses with "jobs" as the host; with three
    // slashes the host is empty. Either way the screen is host + path.
    const path = `/${url.host}/${url.pathname}`.replace(/\/{2,}/g, '/');
    url = new URL(`${path}${url.search}`, SITE);
  } else if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return '/';
  } else if (!SITE_HOSTS.has(url.hostname)) {
    return '/';
  }

  const pathname = url.pathname.replace(LOCALE_PREFIX, '').replace(/\/+$/, '') || '/';
  for (const name of DROPPED_PARAMS) url.searchParams.delete(name);
  const search = url.searchParams.toString();

  return search ? `${pathname}?${search}` : pathname;
}

/**
 * The tab that owns each section of the site, as the route group that is
 * that tab's stack. Only needed for links arriving from outside the app: with
 * no screen to be "similar to", expo-router would otherwise open a shared
 * route in the first tab.
 */
const TAB_OF_SECTION: Record<string, string> = {
  jobs: '(jobs)',
  companies: '(companies)',
};

export function inOwnTab(path: string): string {
  const section = /^\/([^/?#]+)/.exec(path)?.[1];
  const group = section ? TAB_OF_SECTION[section] : undefined;
  return group ? `/${group}${path}` : path;
}
