/**
 * Every page of the website has its place in the app.
 *
 *   node --experimental-strip-types scripts/route-parity.test.mjs   (pnpm test:route-parity)
 *
 * The app's routes mirror the website's paths, so a universal link, a
 * notification's href and a push tap name the same screen on both. Nothing
 * held the two trees together: a page added to the website opened the app
 * (if iOS claimed its section) and landed on the not-found screen, and
 * nobody learned of it until somebody tapped the link.
 *
 * So this reads both trees. Each website page (src/app/[locale]/**\/page.tsx)
 * is put through the app's own mapper (mobile/src/lib/links.ts: the /en
 * prefix off, the pages that live at another path in the app moved) and must
 * then name a screen the app has (mobile/src/app), or be on the list below of
 * pages that stay on the website on purpose — and a page on that list must
 * not be one iOS opens in the app. The list and the mapper are held to the
 * website too: an entry for a page that no longer exists is stale.
 *
 * A page that fails here needs one of three things: a screen in the app, a
 * line in APP_PATHS saying where its screen is, or a line in WEBSITE_ONLY
 * saying it is the website's alone (and, if iOS claims its section, taking
 * it out of OPEN_IN_THE_APP).
 */
import { readdirSync } from 'node:fs';
import { register } from 'node:module';
import { join, relative, sep } from 'node:path';

register('./route-parity-hooks.mjs', import.meta.url);

const { APP_PATHS, appPathFor, webPathToAppPath } = await import('../mobile/src/lib/links.ts');
const { LEGAL_SLUGS } = await import('../src/lib/legal.ts');
const { appSiteAssociation } = await import('../src/lib/apple/app-site-association.ts');

const ROOT = join(import.meta.dirname, '..');
const WEB_PAGES = join(ROOT, 'src', 'app', '[locale]');
const APP_SCREENS = join(ROOT, 'mobile', 'src', 'app');

/**
 * Pages that are the website's alone, each with the reason. The app links to
 * the legal documents and the blog in the in-app browser (its not-found
 * screen offers the same page on the site for anything else); the admin
 * console stays on the website (docs/mobile.md); /employers is the website's
 * landing page for companies; /unsubscribe is an email's one-tap link, which
 * must work without the app; the catch-all is the website's own 404.
 */
const WEBSITE_ONLY = new Map([
  ...LEGAL_SLUGS.map((slug) => [`/${slug}`, 'a legal document, opened in the in-app browser']),
  ['/blog', 'the blog, opened in the in-app browser'],
  ['/blog/[slug]', 'the blog, opened in the in-app browser'],
  ['/employers', "the website's landing page for companies"],
  ['/unsubscribe', "an email's one-tap link"],
  ['/[...rest]', "the website's 404"],
]);
/** A section that is the website's alone, with every page under it. */
const WEBSITE_ONLY_SECTIONS = new Map([['/admin', 'the operations console (docs/mobile.md)']]);

/** Sample values for a dynamic segment: the website's own set where it has one, else any one segment. */
const SAMPLES = { audience: ['candidate', 'employer'] };

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

/** A website page's URL path: the route groups dropped, `page.tsx` the folder itself. */
const webRoutes = files(WEB_PAGES)
  .filter((file) => /[\\/]page\.tsx$/.test(file))
  .map((file) => relative(WEB_PAGES, file).split(sep).slice(0, -1))
  .map((parts) => parts.filter((part) => !/^\(.*\)$/.test(part)))
  .map((parts) => `/${parts.join('/')}`)
  .sort();

/** The app's screens, as segment lists: route groups dropped, `index` the folder itself, `[x]` any one segment. */
const screens = files(APP_SCREENS)
  .filter((file) => /\.tsx?$/.test(file))
  .map((file) => relative(APP_SCREENS, file).replace(/\.tsx?$/, '').split(sep))
  .filter((parts) => !parts.some((part) => part.startsWith('_') || part.startsWith('+')))
  .map((parts) => parts.filter((part) => !/^\(.*\)$/.test(part)))
  .map((parts) => (parts[parts.length - 1] === 'index' ? parts.slice(0, -1) : parts));

function screenFor(path) {
  const segments = path.split(/[?#]/)[0].split('/').filter(Boolean);
  return screens.find(
    (screen) =>
      screen.length === segments.length &&
      screen.every((part, index) => part === segments[index] || /^\[.+\]$/.test(part)),
  );
}

/** A website route's concrete paths, each dynamic segment given its sample values. */
function concrete(route) {
  return route.split('/').reduce(
    (paths, segment) => {
      const dynamic = /^\[(\.\.\.)?(\w+)\]$/.exec(segment);
      const values = dynamic ? (SAMPLES[dynamic[2]] ?? ['x']) : [segment];
      return paths.flatMap((path) => values.map((value) => (path === '' && value === '' ? '' : `${path}/${value}`)));
    },
    [''],
  ).map((path) => path.replace(/\/+/g, '/') || '/');
}

const websiteOnly = (route) =>
  WEBSITE_ONLY.get(route) ??
  [...WEBSITE_ONLY_SECTIONS].find(([prefix]) => route === prefix || route.startsWith(`${prefix}/`))?.[1];

/** iOS's rule for a link to the website: the first component whose pattern matches decides. */
const components = appSiteAssociation(['ABCDE12345.net.brokersconnect.app']).applinks.details[0].components;
function opensApp(pathname) {
  for (const component of components) {
    const pattern = new RegExp(`^${component['/'].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    if (pattern.test(pathname)) return !component.exclude;
  }
  return false;
}

console.log('— the two trees were read');
check(`the website has pages (${webRoutes.length})`, webRoutes.length > 40, webRoutes.join(' '));
check(`the app has screens (${screens.length})`, screens.length > 25);
check('the board is on both', webRoutes.includes('/jobs/[slug]') && Boolean(screenFor('/jobs/x')));
check('a page that is not there would be noticed', screenFor('/jobs/x/applicants') === undefined);

console.log('\n— every website page, through the app’s mapper, is a screen or is the website’s on purpose');
for (const route of webRoutes) {
  const reason = websiteOnly(route);
  if (reason) {
    check(`${route} stays on the website (${reason})`, true);
    continue;
  }
  for (const path of concrete(route)) {
    const inApp = appPathFor(webPathToAppPath(path));
    check(`${route} → ${inApp}`, Boolean(screenFor(inApp)), 'no screen in mobile/src/app, no entry in APP_PATHS, not in WEBSITE_ONLY');
  }
}

console.log('\n— a page iOS opens in the app is never the website’s alone');
for (const route of webRoutes) {
  if (!websiteOnly(route)) continue;
  for (const path of concrete(route)) {
    check(`${path} opens in Safari, not the app`, !opensApp(path), 'listed in WEBSITE_ONLY but claimed by OPEN_IN_THE_APP (src/lib/apple/app-site-association.ts)');
  }
}

console.log('\n— nothing names a page the website no longer has');
for (const route of [...WEBSITE_ONLY.keys(), ...WEBSITE_ONLY_SECTIONS.keys()]) {
  check(`${route} is still a website page`, webRoutes.includes(route), 'take it off the list here');
}
for (const [from, to] of Object.entries(APP_PATHS)) {
  check(`APP_PATHS: ${from} is still a website page`, webRoutes.includes(from), 'take it out of mobile/src/lib/links.ts');
  check(`APP_PATHS: ${from} → ${to} is a screen`, Boolean(screenFor(to)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
