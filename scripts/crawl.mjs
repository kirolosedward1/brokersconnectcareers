/**
 * Every internal link the public site offers, followed once.
 *
 *   pnpm crawl                              # localhost:3000
 *   pnpm crawl https://www.brokersconnect.net
 *
 * The smoke suite asks whether the routes answer. This asks whether the links
 * between them go anywhere — which is a different question, and the one that
 * catches a footer pointing at a slug that was renamed, or a generated landing
 * page whose taxonomy entry has gone. 131 pages today, most of them the
 * track × district cross product, so this is a minute against production
 * rather than something to run on every commit.
 *
 * Two things make the output readable, and both took a wrong answer first.
 *
 * The default locale is served unprefixed and the middleware 307s `/ar/…` to
 * it, so seeding the crawl with `/ar` visits five redirects and stops.
 *
 * And a missing record here is a *soft* 404: these routes stream, so
 * `notFound()` cannot set a status — the headers are gone before the check
 * runs — and the answer is a 200 carrying `robots: noindex`. Matching the
 * not-found copy instead does not work, because next-intl ships the whole
 * message catalogue to the browser and every page therefore contains that
 * sentence; the first run reported all 131 pages as missing, including the
 * home page.
 *
 * Noindex is not always a fault, so the report sorts it:
 *
 *   a landing page with no live listing — deliberate. The 126 track × district
 *     pages stay reachable and internally linked; only the ones with something
 *     on them go in the sitemap, because submitting 114 empty result pages to
 *     Google is thin content volunteered rather than crawled.
 *   a gated consultant profile — deliberate. Browsable from the directory,
 *     never advertised to a crawler.
 *   anything else — a real soft 404, and the exit code says so.
 *
 * Which of those a page is comes from its `<title>`, not from the shape of its
 * path. The first version read the slug — six trailing digits meant a listing,
 * anything else a landing page — and that is exactly backwards for the failure
 * worth catching: a footer link to a district that had been renamed would have
 * been filed as "deliberate, no live listing" and never reported. A page that
 * exists has a title of its own; a page that does not falls back to the site's
 * default. The default is read from a deliberately absent path at startup
 * rather than written in here, so it cannot drift from the real one.
 */
const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');

const SEEDS = ['/', '/jobs', '/companies', '/agents', '/blog', '/employers', '/privacy', '/terms'];

/** Behind a sign-in, or not a page. Crawling these proves nothing about links. */
const PRIVATE =
  /^\/(dashboard|employer|admin|notifications|onboarding|sign-in|sign-up|unsubscribe|auth|api)/;

const title = (body) => (body.match(/<title>([^<]*)<\/title>/) ?? [])[1]?.trim() ?? '';

/*
  The signature of a page that is not there, read from one that certainly is
  not. Every real page sets its own <title>; a notFound() falls through to the
  layout's default.
*/
const probe = await fetch(`${BASE}/jobs/__crawl-probe-does-not-exist__`);
const MISSING_TITLE = title(await probe.text());
if (!MISSING_TITLE) {
  console.error('could not read the not-found title — is the server up?');
  process.exit(2);
}

const seen = new Set();
const queue = [...SEEDS];
const expected = { landing: [], gated: [] };
const problems = [];
let checked = 0;

while (queue.length) {
  const path = queue.shift();
  if (seen.has(path) || PRIVATE.test(path)) continue;
  seen.add(path);

  let response;
  let body = '';
  try {
    response = await fetch(BASE + path);
    body = await response.text();
  } catch (error) {
    problems.push(`${path} — fetch failed: ${error.message}`);
    continue;
  }
  checked += 1;

  if (response.status !== 200) {
    problems.push(`${path} — ${response.status}`);
    continue;
  }

  if (/<meta name="robots" content="[^"]*noindex/.test(body)) {
    if (title(body) === MISSING_TITLE) problems.push(`${path} — soft 404`);
    else if (path.startsWith('/jobs/')) expected.landing.push(path);
    else if (path.startsWith('/agents/')) expected.gated.push(path);
    else problems.push(`${path} — noindex, and not a page this script knows about`);
  }

  for (const match of body.matchAll(/href="(\/[^"#?]*)"/g)) {
    const href = match[1].replace(/\/$/, '') || '/';
    // `/en` is the same graph in the other language; one pass is the point.
    if (!seen.has(href) && !PRIVATE.test(href) && !href.startsWith('/en')) queue.push(href);
  }
}

console.log(`\ncrawl: ${BASE}`);
console.log(`  ${checked} pages, ${seen.size - checked} skipped`);
console.log(`  ${expected.landing.length} landing pages with no live listing (deliberate)`);
console.log(`  ${expected.gated.length} gated consultant profiles (deliberate)`);

if (problems.length === 0) {
  console.log('\n  no broken links\n');
  process.exit(0);
}

console.log(`\n  ${problems.length} to look at:`);
for (const line of problems.slice(0, 40)) console.log(`    ${line}`);
if (problems.length > 40) console.log(`    … and ${problems.length - 40} more`);
console.log('');
process.exit(1);
