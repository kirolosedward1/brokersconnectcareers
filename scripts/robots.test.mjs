/**
 * What robots.txt keeps out of the crawl, read the way a crawler reads it.
 *
 *   node --experimental-strip-types scripts/robots.test.mjs   (in pnpm test:seo)
 *
 * A Disallow rule is a prefix, so a rule written for one area can quietly
 * cover a public page that starts with the same letters — `/employer` kept
 * search engines off `/employers`, the page for companies, while the sitemap
 * asked them to read it. Every page the sitemap lists must stay crawlable,
 * every private area must stay out, and the facets the rules leave in on
 * purpose must stay in.
 */
import { readFileSync } from 'node:fs';
import { ALLOW, disallowRules, isDisallowed } from '../src/lib/seo/robots-rules.ts';

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
}

const read = (path) => readFileSync(path, 'utf8');

// The sitemap's fixed pages, as sitemap.ts writes them, and the legal pages it adds.
const sitemap = read('src/app/sitemap.ts');
const fixed = [...sitemap.matchAll(/entry\('(\/[^'`$]*)'/g)].map((match) => match[1]);
const slugList = read('src/lib/legal.ts').match(/LEGAL_SLUGS = \[([^\]]+)\] as const/);
const legal = slugList ? [...slugList[1].matchAll(/'([\w-]+)'/g)].map((match) => `/${match[1]}`) : [];

console.log('— the sitemap is read as written');
check('sitemap.ts lists its fixed pages', fixed.includes('/') && fixed.includes('/employers'), fixed.join(', '));
check('lib/legal.ts names the legal pages', legal.length >= 5, legal.join(', '));
check(
  'robots.ts serves these rules',
  read('src/app/robots.ts').includes('disallow: disallowRules(ENGLISH_ENABLED)') &&
    read('src/app/robots.ts').includes('allow: ALLOW'),
);

// What the sitemap builds from the database, one of each shape.
const PUBLIC = [
  ...fixed,
  ...legal,
  '/jobs/sales-manager-new-cairo-123456', // a listing
  '/jobs/primary-new-cairo', // a track x district landing
  '/companies/nile-brokers',
  '/blog/how-commission-works',
];

// Facets left in on purpose (lib/seo/robots-rules.ts says why).
const CRAWLABLE = ['/jobs?track=primary', '/jobs?district=new-cairo', '/jobs?page=2', '/agents/a1b2c3'];

// What a page is drawn with: Next's image optimiser, whose own `q` is the
// image's quality — a logo of ours, and a company's logo from Storage.
const ASSETS = [
  '/_next/image?url=%2Fbrand%2Flogo-mark.png&w=64&q=75',
  '/_next/image?url=https%3A%2F%2Fhiwdhicwsohbipxzazmb.supabase.co%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fcompany-logos%2Fc%2Flogo-1.webp&w=128&q=75',
];

const PRIVATE = [
  '/employer',
  '/employer/jobs',
  '/employer/jobs/new',
  '/employer?tab=team',
  '/dashboard',
  '/dashboard/account',
  '/admin',
  '/admin/jobs/42',
  '/notifications',
  '/onboarding',
  '/onboarding?next=/jobs',
  '/auth/callback?code=x',
  '/api/health',
  '/jobs/sales-manager-new-cairo-123456/apply',
  '/jobs?q=sales',
  '/jobs?track=primary&sort=newest',
  '/companies?q=nile',
  '/agents?availability=actively_searching',
];

for (const english of [false, true]) {
  const rules = disallowRules(english);
  console.log(`— English ${english ? 'on' : 'off'}`);
  const prefixes = english ? ['', '/en'] : [''];
  for (const prefix of prefixes) {
    for (const path of PUBLIC) {
      const url = prefix && path === '/' ? prefix : `${prefix}${path}`;
      check(`a crawler may read ${url}`, !isDisallowed(url, rules));
    }
    for (const path of CRAWLABLE) check(`a crawler may read ${prefix}${path}`, !isDisallowed(`${prefix}${path}`, rules));
  }
  for (const path of ASSETS) check(`a crawler may fetch ${path.slice(0, 48)}…`, !isDisallowed(path, rules));
  for (const path of PRIVATE) check(`a crawler keeps out of ${path}`, isDisallowed(path, rules));
  if (english) {
    for (const path of [
      '/en/employer',
      '/en/employer/jobs',
      '/en/dashboard',
      '/en/admin',
      '/en/onboarding',
      '/en/jobs/sales-manager-new-cairo-123456/apply',
    ]) {
      check(`a crawler keeps out of ${path}`, isDisallowed(path, rules));
    }
  }
}

console.log('— the matcher reads rules as Google does');
check('a rule is a prefix', isDisallowed('/admin/x', ['/admin']));
check('`$` ends the match', !isDisallowed('/employers', ['/employer$']) && isDisallowed('/employer', ['/employer$']));
check('`*` stands for any run of characters', isDisallowed('/jobs/a/b/apply', ['/jobs/*/apply']));
check('`?` is a character, not a pattern', !isDisallowed('/employe', ['/employer?']) && isDisallowed('/employer?x=1', ['/employer?']));
check('the longer rule decides: an Allow longer than a Disallow lets it through',
  !isDisallowed('/_next/image?url=x&q=75', ['/*?*&q='], ['/', '/_next/image']));
check('and a Disallow longer than an Allow keeps it out', isDisallowed('/jobs?q=sales', ['/*?q='], ['/']));
check('an Allow as long as a Disallow wins', !isDisallowed('/a', ['/a'], ['/a']));
check('the Allow lines robots.ts serves start with /', ALLOW[0] === '/');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
