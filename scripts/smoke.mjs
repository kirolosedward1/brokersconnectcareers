#!/usr/bin/env node
/**
 * Smoke tests against a running server.
 *
 *   pnpm build && pnpm start &
 *   pnpm smoke                     # or: pnpm smoke https://careers2.brokersconnect.net
 *
 * These exist because of what has actually broken here, not because of what
 * might. Every assertion below corresponds to a regression this codebase has
 * shipped at least once:
 *
 *   - middleware threw and every URL on the site returned 500
 *   - a deploy served pages whose data layer had no credentials
 *   - the sitemap silently lost every blog post
 *   - robots.txt emitted a relative Sitemap line
 *   - JobPosting markup named the district as the region
 *   - an unsubscribe link would have fired on a mail client's prefetch
 *
 * Unit tests would not have caught one of them. They are all contract
 * failures at the HTTP boundary, which is where this checks.
 */

const BASE = (process.argv[2] ?? process.env.SMOKE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

let pass = 0;
let fail = 0;

function section(title) {
  console.log(`\n— ${title}`);
}

function check(label, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function get(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, { redirect: 'manual', ...options });
  const body = await response.text().catch(() => '');
  return { status: response.status, headers: response.headers, body };
}

console.log(`smoke: ${BASE}`);

// ---------------------------------------------------------------------------
section('every public route answers');
// A 500 here is the failure that took the whole site down twice.
for (const path of [
  '/',
  '/jobs',
  '/employers',
  '/companies',
  '/agents',
  '/blog',
  '/sign-in',
  '/sign-up',
  '/privacy',
  '/terms',
]) {
  const { status } = await get(path);
  check(`${path} -> 200`, status === 200, `got ${status}`);
}

// ---------------------------------------------------------------------------
section('private routes stay private');
for (const path of ['/dashboard', '/dashboard/account', '/employer', '/admin', '/onboarding']) {
  const { status, headers } = await get(path);
  const location = headers.get('location') ?? '';
  check(
    `${path} redirects a stranger to sign-in`,
    status === 307 && location.includes('/sign-in'),
    `got ${status} ${location}`,
  );
}

// ---------------------------------------------------------------------------
section('robots and sitemap are absolute and complete');
{
  const robots = await get('/robots.txt');
  check('robots.txt -> 200', robots.status === 200, `got ${robots.status}`);
  check(
    'its Sitemap line is absolute',
    /^Sitemap:\s*https?:\/\//m.test(robots.body),
    robots.body.split('\n').find((line) => line.startsWith('Sitemap')) ?? '<none>',
  );
  check('it disallows the private areas', robots.body.includes('/dashboard'));

  const sitemap = await get('/sitemap.xml');
  const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check('sitemap.xml -> 200', sitemap.status === 200, `got ${sitemap.status}`);
  check('every URL in it is absolute', locs.length > 0 && locs.every((l) => /^https?:\/\//.test(l)), locs[0]);
  check(
    'the blog posts are in it',
    locs.some((l) => l.includes('/blog/')),
    `${locs.length} urls, none under /blog/`,
  );
  check('the employer landing is in it', locs.some((l) => l.endsWith('/employers')));
}

// ---------------------------------------------------------------------------
section('a job listing carries valid Google Jobs markup');
{
  const list = await get('/jobs');
  // Anchored on an actual href. A bare path pattern also matches Next's own
  // chunk filenames — .../(site)/jobs/page-514174dd2887c68c.js reads as a
  // perfectly good slug — and which of those matches first changes with every
  // build hash, so the loose version passed or failed at random.
  const slug = list.body.match(/href="(\/jobs\/[a-z0-9-]+-\d{6})"/)?.[1];

  if (!slug) {
    check('found a listing to inspect', false, 'no job links on /jobs — is the database reachable?');
  } else {
    const page = await get(slug);
    const raw = page.body.match(
      /<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s,
    )?.[1];

    let data = null;
    try {
      data = JSON.parse(raw ?? '');
    } catch {
      /* handled below */
    }

    check('the page embeds JSON-LD', Boolean(data), slug);

    if (data) {
      for (const field of ['title', 'description', 'datePosted', 'hiringOrganization', 'jobLocation']) {
        check(`it has ${field}`, Boolean(data[field]));
      }
      check(
        'the region is not just the district repeated',
        data.jobLocation?.address?.addressRegion !== data.jobLocation?.address?.addressLocality,
        `${data.jobLocation?.address?.addressRegion}`,
      );
      check(
        'experience is a number Google can filter on',
        typeof data.experienceRequirements?.monthsOfExperience === 'number',
        JSON.stringify(data.experienceRequirements),
      );
      check('the description is HTML', /^<p>/.test(data.description ?? ''), data.description?.slice(0, 40));
    }
  }
}

// ---------------------------------------------------------------------------
section('endpoints that change things refuse to on a GET');
{
  // Mail clients prefetch links. A GET that unsubscribed would fire for people
  // who never clicked.
  const unsub = await get('/api/unsubscribe?token=00000000-0000-0000-0000-000000000000&kind=notify_digest');
  check(
    'GET /api/unsubscribe only redirects to the confirm page',
    unsub.status === 303 && (unsub.headers.get('location') ?? '').includes('/unsubscribe'),
    `got ${unsub.status}`,
  );

  const cronExpire = await get('/api/cron/expire-jobs');
  check('the expiry cron needs its secret', cronExpire.status === 401, `got ${cronExpire.status}`);

  const cronAlerts = await get('/api/cron/job-alerts');
  check('the alert cron needs its secret', cronAlerts.status === 401, `got ${cronAlerts.status}`);

  const exportRoute = await get('/api/account/export');
  check('the data export needs a session', exportRoute.status === 401, `got ${exportRoute.status}`);

  const webhook = await get('/api/paymob/webhook', { method: 'POST', body: '{}' });
  check(
    'the payment webhook refuses an unsigned body',
    webhook.status === 400 || webhook.status === 401 || webhook.status === 503,
    `got ${webhook.status}`,
  );
}

// ---------------------------------------------------------------------------
section('each side of the marketplace has its own door');
{
  for (const path of ['/sign-in/candidate', '/sign-in/employer', '/sign-up/candidate', '/sign-up/employer']) {
    const { status } = await get(path);
    check(`${path} -> 200`, status === 200, `got ${status}`);
  }

  // The neutral routes stay, so every existing link and email still resolves.
  for (const path of ['/sign-in', '/sign-up']) {
    const { status } = await get(path);
    check(`${path} still works`, status === 200, `got ${status}`);
  }

  const bogus = await get('/sign-up/recruiter');
  check('an unknown audience 404s', bogus.status === 404, `got ${bogus.status}`);

  const employer = await get('/sign-up/employer');
  check(
    'the employer door offers the employer argument',
    employer.body.includes('وظّف') || employer.body.includes('Hire'),
  );
}

// ---------------------------------------------------------------------------
section('the two landing pages are distinct and cross-linked');
{
  const candidate = await get('/');
  const employer = await get('/employers');

  const h1 = (body) => body.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1].replace(/<[^>]+>/g, '').trim();

  check('each has its own h1', Boolean(h1(candidate.body)) && h1(candidate.body) !== h1(employer.body), `${h1(candidate.body)} / ${h1(employer.body)}`);
  check('the candidate page links to the employer one', candidate.body.includes('href="/employers"'));
  check('and back again', employer.body.includes('href="/"'));
}

// ---------------------------------------------------------------------------
section('the closed English side stays closed');
{
  const en = await get('/en/jobs');
  check('/en/* redirects', en.status === 307, `got ${en.status}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
