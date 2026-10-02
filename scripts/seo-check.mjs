/**
 * What a search engine is told, checked page by page.
 *
 *   pnpm seo:check                               # localhost:3000
 *   pnpm seo:check https://www.brokersconnect.net
 *
 * `pnpm crawl` asks whether the links go anywhere. This asks whether every
 * page gives Google one consistent instruction:
 *
 *   every URL in the sitemap answers 200, is indexable, and names itself as
 *     canonical — a sitemap URL that is noindexed or canonicalised elsewhere
 *     is a contradiction Search Console reports and ranks nothing;
 *   every listing in the sitemap carries exactly one JobPosting, and that
 *     payload passes the same rules scripts/job-posting.test.mjs checks;
 *   no page that is not a listing carries JobPosting;
 *   a filtered, sorted or paged list is noindex and names no other page as
 *     canonical;
 *   a listing that is not open carries no JobPosting and is noindex;
 *   a listing, company or profile that does not exist answers 404;
 *   robots.txt names the sitemap and keeps private areas and facets out.
 *
 * Extra URLs to probe as "must not be indexed" can follow the base URL.
 */
import { jobPostingProblems } from '../src/lib/seo/job-posting-core.ts';
import { isDisallowed } from '../src/lib/seo/robots-rules.ts';

const [baseArg, ...extraNoindex] = process.argv.slice(2);
const BASE = (baseArg ?? 'http://localhost:3000').replace(/\/$/, '');

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
}

async function get(path) {
  const response = await fetch(path.startsWith('http') ? path : `${BASE}${path}`, { redirect: 'manual' });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

function head(html) {
  const robots = (html.match(/<meta name="robots" content="([^"]*)"/) ?? [])[1] ?? '';
  const canonical = (html.match(/<link rel="canonical" href="([^"]*)"/) ?? [])[1] ?? null;
  const title = (html.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? '';
  const description = (html.match(/<meta name="description" content="([^"]*)"/) ?? [])[1] ?? '';
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1]),
  );
  return { robots, canonical, title, description, ld, noindex: /noindex/.test(robots) };
}

/** One URL, whatever the trailing slash on a bare origin. */
const same = (a, b) => a != null && b != null && new URL(a).href === new URL(b).href;

const isListing = (path) => /^\/jobs\/[a-z0-9-]+-\d{6}$/.test(path);

console.log('— robots.txt');
const robots = await get('/robots.txt');
check('answers 200', robots.status === 200);
check('names the sitemap', /Sitemap: https?:\/\/\S+\/sitemap\.xml/.test(robots.body));
for (const path of ['/dashboard', '/employer$', '/employer/', '/admin', '/api', '/jobs/*/apply', '/*?sort=', '/*?q=']) {
  check(`disallows ${path}`, robots.body.includes(`Disallow: ${path}\n`));
}
// Read as a crawler reads them: a rule is a prefix, and one written for a
// private area must not also cover a page the sitemap asks to be read.
const disallowed = [...robots.body.matchAll(/^Disallow: (\S+)$/gm)].map((match) => match[1]);

console.log('\n— sitemap');
const sitemap = await get('/sitemap.xml');
const urls = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check('answers 200 with URLs', sitemap.status === 200 && urls.length > 0, `${urls.length} URLs`);
const origin = new URL(urls[0] ?? BASE).origin;
check('every URL is absolute on one origin', urls.every((url) => url.startsWith(origin)));
check('no duplicates', new Set(urls).size === urls.length);
check('no query strings', urls.every((url) => !url.includes('?')));
const blocked = urls.filter((url) => isDisallowed(new URL(url).pathname, disallowed));
check('robots.txt lets a crawler read every URL in it', blocked.length === 0, blocked.slice(0, 5).join(', '));

console.log(`\n— every sitemap URL (${urls.length})`);
const listings = [];
for (const url of urls) {
  const path = new URL(url).pathname;
  const page = await get(`${BASE}${path}`);
  const meta = head(page.body);
  const problems = [];
  if (page.status !== 200) problems.push(`status ${page.status}`);
  if (meta.noindex) problems.push(`robots "${meta.robots}"`);
  if (!same(meta.canonical, url)) problems.push(`canonical ${meta.canonical}`);
  if (!meta.title) problems.push('no title');
  if (!meta.description) problems.push('no description');
  const postings = meta.ld.filter((item) => item['@type'] === 'JobPosting');
  if (isListing(path)) {
    listings.push(path);
    if (postings.length !== 1) problems.push(`${postings.length} JobPosting blocks`);
    else {
      const rules = jobPostingProblems(postings[0]);
      if (rules.length) problems.push(...rules);
      if (postings[0].url !== url) problems.push(`JobPosting.url ${postings[0].url}`);
    }
  } else if (postings.length) {
    problems.push('JobPosting on a page that is not a listing');
  }
  check(path, problems.length === 0, problems.join('; '));
}

console.log('\n— views and closed pages are kept out of the index');
const views = ['/jobs?track=primary', '/jobs?page=2', '/jobs?sort=salary', '/companies?q=a', '/agents?track=primary'];
const closed = [];
for (const url of extraNoindex) closed.push(new URL(url, BASE).pathname + new URL(url, BASE).search);
const missing = ['/jobs/this-listing-does-not-exist-000000', '/companies/no-such-company', '/agents/no-such-agent', '/no-such-page'];
for (const path of [...views, ...closed, ...missing]) {
  const page = await get(path);
  const meta = head(page.body);
  const postings = meta.ld.filter((item) => item['@type'] === 'JobPosting');
  const problems = [];
  if (!meta.noindex) problems.push(`robots "${meta.robots}"`);
  // Noindex beside a canonical naming *another* page is two contradictory
  // instructions. Naming itself is harmless, which is what a closed listing does.
  if (meta.canonical && !same(meta.canonical, `${origin}${path}`)) problems.push(`canonical ${meta.canonical}`);
  if (postings.length) problems.push('carries JobPosting');
  // A record that is not there is a real 404 to an anonymous visitor, not
  // the not-found page under a 200 (see lib/seo/record-exists.ts).
  if (missing.includes(path) && page.status !== 404) problems.push(`status ${page.status}, want 404`);
  check(`${path} (${page.status})`, problems.length === 0, problems.join('; '));
}

console.log(`\n${pass} passed, ${fail} failed · ${listings.length} listings validated`);
process.exit(fail ? 1 : 0);
