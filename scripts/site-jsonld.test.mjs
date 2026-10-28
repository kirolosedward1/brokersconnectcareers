/**
 * WebSite and Organization JSON-LD, favicons, the canonical host, and the
 * crawl files a sitelink result depends on.
 *
 *   node --experimental-strip-types scripts/site-jsonld.test.mjs   (in pnpm test:seo)
 */
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { breadcrumbJsonLd } = await import('../src/lib/seo/breadcrumbs.ts');
const { canonicalSiteUrl } = await import('../src/lib/seo/canonical-host.ts');
const { jobPostingProblems } = await import('../src/lib/seo/job-posting-core.ts');
const { areaLandingPath } = await import('../src/lib/seo/area-links.ts');
const { disallowRules, isDisallowed } = await import('../src/lib/seo/robots-rules.ts');
const { organizationJsonLd, organizationProblems, websiteJsonLd, websiteProblems } = await import(
  '../src/lib/seo/site-jsonld.ts'
);

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
}

const ORIGIN = 'https://www.brokersconnect.net';

console.log('— WebSite and Organization');
{
  const website = websiteJsonLd(ORIGIN);
  const organization = organizationJsonLd(ORIGIN);
  check('WebSite matches schema.org and the SearchAction rules', websiteProblems(website).length === 0, websiteProblems(website).join(', '));
  check(
    'Organization matches schema.org and the logo rules',
    organizationProblems(organization).length === 0,
    organizationProblems(organization).join(', '),
  );
  check('the site name is the Latin brand', website.name === 'Brokers Connect' && organization.name === 'Brokers Connect');
  check('Arabic is an alternate name, not the site name', website.alternateName[0] === 'بروكرز كونكت');
  check('there is no invented sameAs', !('sameAs' in website) && !('sameAs' in organization));
  check('the search target is the jobs board', website.potentialAction.target.urlTemplate === `${ORIGIN}/jobs?q={search_term_string}`);
  check('the contact email is the operator', organization.contactPoint.email === 'info@topsuite.net');

  const broken = organizationJsonLd(ORIGIN);
  broken.sameAs = [ORIGIN];
  broken.logo = '/brand/logo-mark.png';
  check('a relative logo and a sameAs are rejected', organizationProblems(broken).includes('logo') && organizationProblems(broken).includes('sameAs'));
}

console.log('— BreadcrumbList and JobPosting');
{
  process.env.NEXT_PUBLIC_SITE_URL = ORIGIN;
  const crumbs = breadcrumbJsonLd(
    [
      { name: 'بروكرز كونكت', path: '/' },
      { name: 'الوظائف' },
    ],
    'ar',
  );
  const items = crumbs.itemListElement;
  check('BreadcrumbList is a list', crumbs['@context'] === 'https://schema.org' && crumbs['@type'] === 'BreadcrumbList');
  check('positions start at 1', items[0].position === 1 && items[1].position === 2);
  check('the parent crumb is an absolute www URL', items[0].item === `${ORIGIN}/`);
  check('the current crumb has no item', items[1].item === undefined);

  const missing = jobPostingProblems({});
  for (const field of ['datePosted', 'description', 'hiringOrganization', 'jobLocation', 'title']) {
    check(`JobPosting requires ${field}`, missing.includes(`missing ${field}`));
  }
}

console.log('— one canonical host');
{
  check('apex becomes www', canonicalSiteUrl('https://brokersconnect.net') === ORIGIN);
  check('apex keeps its path', canonicalSiteUrl('http://brokersconnect.net/jobs') === `${ORIGIN}/jobs`);
  check('www is unchanged', canonicalSiteUrl(ORIGIN) === ORIGIN);
  check('a preview host is unchanged', canonicalSiteUrl('https://brokers.example') === 'https://brokers.example');
  check('localhost is unchanged', canonicalSiteUrl('http://localhost:3000') === 'http://localhost:3000');

  const config = readFileSync('next.config.ts', 'utf8');
  check('apex redirects with 301', config.includes("value: 'brokersconnect.net'") && config.includes('statusCode: 301'));
  check('the redirect destination is www', config.includes('https://www.brokersconnect.net/:path*'));
}

console.log('— favicons and the logo');
{
  function pngSize(path) {
    const buf = readFileSync(path);
    check(`${path} is a PNG`, buf.toString('ascii', 12, 16) === 'IHDR');
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  for (const size of [48, 96, 192]) {
    const dim = pngSize(`public/favicon-${size}x${size}.png`);
    check(`favicon ${size} is square`, dim.width === size && dim.height === size, `${dim.width}x${dim.height}`);
  }
  const icon = pngSize('src/app/icon.png');
  check('app/icon.png is 192 square', icon.width === 192 && icon.height === 192, `${icon.width}x${icon.height}`);
  const logo = pngSize('public/brand/logo-mark.png');
  check('the organization logo is square and at least 112px', logo.width === logo.height && logo.width >= 112, `${logo.width}x${logo.height}`);

  {
    // app/favicon.ico is what Next serves at /favicon.ico. A second copy in
    // public/ conflicts with it and the URL 500s.
    const path = 'src/app/favicon.ico';
    const ico = readFileSync(path);
    const width = ico[6] || 256;
    const height = ico[7] || 256;
    check(`${path} is a 48px icon`, ico.readUInt16LE(2) === 1 && width === 48 && height === 48, `${width}x${height}`);
    check('public/favicon.ico is not also present', !existsSync('public/favicon.ico'));
  }

  const layout = readFileSync('src/app/[locale]/layout.tsx', 'utf8');
  check('the icon links name the 48, 96 and 192 files', layout.includes('/favicon-48x48.png') && layout.includes('/favicon-96x96.png') && layout.includes('/favicon-192x192.png') && layout.includes('/favicon.ico'));
  check('og:site_name is the Latin brand', layout.includes('siteName: SITE_NAME'));
  check(
    'Search Console verification comes from the env var',
    layout.includes('NEXT_PUBLIC_GSC_VERIFICATION') && layout.includes('configuredValue('),
  );
  check('no verification token is hardcoded', !/google:\s*['"][A-Za-z0-9_-]{8,}['"]/.test(layout));
  const example = readFileSync('.env.example', 'utf8');
  check('the env example documents an empty verification var', /NEXT_PUBLIC_GSC_VERIFICATION=\s*$/m.test(example));
}

console.log('— crawl files');
{
  const disallow = disallowRules(false);
  const allowed = (path) => !isDisallowed(path, disallow);
  for (const path of ['/', '/jobs', '/companies', '/employers', '/sign-in', '/sign-up', '/favicon.ico', '/favicon-48x48.png', '/favicon-192x192.png', '/brand/logo-mark.png']) {
    check(`${path} is crawlable`, allowed(path));
  }
  for (const path of ['/admin', '/admin/jobs', '/dashboard', '/dashboard/account', '/api', '/api/health']) {
    check(`${path} is blocked`, !allowed(path));
  }

  const sitemap = readFileSync('src/app/sitemap.ts', 'utf8');
  check('the sitemap dates the catalogue change', sitemap.includes("new Date('2026-10-27T00:00:00.000Z')"));
  check('sign-in and sign-up are in the sitemap', sitemap.includes("entry('/sign-in'") && sitemap.includes("entry('/sign-up'"));
  check('sitemap URLs use the site origin', sitemap.includes('env.siteUrl'));

  const signIn = readFileSync('src/app/[locale]/sign-in/page.tsx', 'utf8');
  const signUp = readFileSync('src/app/[locale]/sign-up/page.tsx', 'utf8');
  check('the sign-in page is indexable', !signIn.includes('index: false') && signIn.includes("alternatesFor('/sign-in'"));
  check('the sign-up page is indexable', !signUp.includes('index: false') && signUp.includes("alternatesFor('/sign-up'"));

  check('new cairo is an indexable landing', areaLandingPath('new-cairo') === '/jobs/primary-sales-new-cairo');
  check('the new capital is an indexable landing', areaLandingPath('new-capital') === '/jobs/primary-sales-new-capital');
  check('sheikh zayed is an indexable landing', areaLandingPath('sheikh-zayed') === '/jobs/primary-sales-sheikh-zayed');

  const footer = readFileSync('src/components/site-footer.tsx', 'utf8');
  const header = readFileSync('src/components/site-header.tsx', 'utf8');
  check('the footer links the sitelink pages and areas', footer.includes('SITELINK_PAGES') && footer.includes('SITELINK_AREAS'));
  check('the header links the area landings', header.includes('SITELINK_AREAS') && header.includes('areaLandingPath'));
  check('the header does not repeat the employer or sign-up sitelinks', !header.includes('SITELINK_PAGES') && !header.includes('forEmployers') && !header.includes('announceJob'));

  const account = readFileSync('src/components/session/header-account.tsx', 'utf8');
  check('the signed-out header keeps sign-in and the post button', account.includes('href="/sign-in"') && account.includes('anonymousPostHref') && account.includes('{postJob}'));
  check('the signed-out header does not offer sign-up', !account.includes('/sign-up'));

  const panel = readFileSync('src/components/auth/brand-panel.tsx', 'utf8');
  const proof = readFileSync('src/lib/queries/market-proof.ts', 'utf8');
  check('the auth panel asks the database for its counts', panel.includes('getMarketProof') && proof.includes('getBrowseCounts') && proof.includes("verification_status', 'verified'"));
  check('the auth panel has no baked-in count', !/\d{2,}\s*(وظيفة|published)/.test(panel));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
