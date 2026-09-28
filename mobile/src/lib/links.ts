import {
  directoryDeniedRedirect,
  mayEnter,
  routeAudience,
  type Actor,
  type RouteAudience,
} from '@/lib/permissions';
import { tabsFor, type TabName } from './tabs';

/**
 * Website addresses as app paths.
 *
 * The app's routes mirror the website's paths — /jobs, /jobs/<slug>,
 * /companies/<slug>, /dashboard/applications — so a universal link, a
 * notification's `href` and a push tap all name a screen the same way the site
 * names a page. What differs is only the wrapping: a full URL instead of a
 * path, the /en prefix English pages carry, and the `?src=share` tag the share
 * button adds (which only the website counts). A few pages have another home
 * in the app (appPathFor).
 *
 * Anything not on the site's own hosts, or not a web address at all, goes
 * home rather than anywhere it names. Pure; tests/links.test.ts.
 *
 * A link from outside the app also says which tab it opens in (inOwnTab): a
 * listing is shown in the Jobs tab with the board under it, a company in the
 * Companies tab over the directory. Inside the app the same paths stay in
 * whichever tab the reader is using, which is expo-router's default.
 *
 * And a link is for somebody: the website's middleware and page guards decide
 * who may open each section (src/lib/permissions.ts), and the app asks the
 * same question before opening one (routeFromOutside, routeInside).
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

/** The path without its query or fragment. */
function pathnameOf(path: string): string {
  return path.split(/[?#]/, 1)[0] || '/';
}

/**
 * Pages whose app screen lives at another path: the candidate's overview is
 * the home tab, the employer's console will be too, and the account settings
 * and the directory profile the website keeps under /dashboard are the
 * Account tab.
 */
const APP_PATHS: Record<string, string> = {
  '/dashboard': '/',
  '/dashboard/account': '/account',
  '/dashboard/profile': '/account/profile',
  '/employer': '/',
};

/** A website path (already through webPathToAppPath) as the app opens it; the query is kept. */
export function appPathFor(path: string): string {
  const pathname = pathnameOf(path);
  const mapped = APP_PATHS[pathname];
  return mapped === undefined ? path : `${mapped}${path.slice(pathname.length)}`;
}

/**
 * The tab that owns each section, for links arriving from outside the app:
 * with no screen to be "similar to", expo-router would open a page every tab
 * can show (a listing, the bell's feed) in whichever tab sorts first. Each
 * section names its tabs in order of preference; the first this person has
 * wins.
 */
const TAB_OF_SECTION: readonly (readonly [prefix: string, owners: readonly TabName[]])[] = [
  ['/jobs', ['jobs']],
  ['/companies', ['companies', 'home']],
  ['/dashboard/applications', ['applications']],
  ['/dashboard/saved', ['saved']],
  ['/account', ['account']],
  ['/notifications', ['home']],
];

export function inOwnTab(path: string, tabs: readonly TabName[]): string {
  const pathname = pathnameOf(path);
  const owners = TAB_OF_SECTION.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1];
  const owner = owners?.find((tab) => tabs.includes(tab));
  return owner ? `/(${owner})${path}` : path;
}

/**
 * Where somebody goes instead of a page that is not for them — the website's
 * rules. Signed out, the sign-in sheet, which comes back to the page after;
 * a candidate who reached for the consultant directory, their own profile
 * with the reason; anybody else, home.
 */
function deniedPath(path: string, actor: Actor, audience: RouteAudience): string {
  if (!actor) return `/sign-in?next=${encodeURIComponent(path)}`;
  if (audience === 'directory') return appPathFor(directoryDeniedRedirect(actor));
  return '/';
}

/** A page anybody may open, signed in or not. */
export function isPublicPath(input: string): boolean {
  return routeAudience(pathnameOf(webPathToAppPath(input))) === 'public';
}

/**
 * Where a link from outside the app — a universal link, the app's own scheme,
 * a cold start from either — opens for this person: the page, in the tab that
 * owns it, when they may see it; otherwise where the website would send them.
 */
export function routeFromOutside(input: string, actor: Actor): string {
  const path = webPathToAppPath(input);
  const audience = routeAudience(pathnameOf(path));
  if (!mayEnter(actor, audience)) return deniedPath(path, actor, audience);
  return inOwnTab(appPathFor(path), tabsFor(actor));
}

/**
 * The same decision for a path the app itself is about to open — where a
 * sign-in was headed, where a notification points. Inside the app the page
 * opens in the tab the reader is using, so no tab is named.
 */
export function routeInside(input: string, actor: Actor): string {
  const path = webPathToAppPath(input);
  const audience = routeAudience(pathnameOf(path));
  if (!mayEnter(actor, audience)) return deniedPath(path, actor, audience);
  return appPathFor(path);
}
