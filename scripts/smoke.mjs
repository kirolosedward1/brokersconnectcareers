#!/usr/bin/env node
/**
 * Smoke tests against a running server.
 *
 *   pnpm build && pnpm start &
 *   pnpm smoke                     # or: pnpm smoke https://www.brokersconnect.net
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

import { readFileSync as read } from 'node:fs';

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
for (const path of [
  '/dashboard',
  '/dashboard/account',
  '/employer',
  '/admin',
  '/admin/users',
  '/employer/applicants',
  '/notifications',
  '/onboarding',
]) {
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
  // Every private prefix, not just the first one. Checking a single path let
  // /notifications ship crawlable — it was added to the app and not here.
  const privatePrefixes = ['/dashboard', '/employer', '/admin', '/notifications', '/onboarding', '/api'];
  const uncovered = privatePrefixes.filter((prefix) => !robots.body.includes(`Disallow: ${prefix}`));
  check('it disallows every private area', uncovered.length === 0, uncovered.join(', '));

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
section('the sign-in screen offers only what works');
{
  // "Continue with Google" was rendered unconditionally while the provider was
  // never enabled, so every click returned "provider is not enabled" — on the
  // first screen a new user meets, from the most trustworthy-looking control
  // on it. The invariant is not "no Google button"; it is that the button and
  // the auth server agree.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    console.log('  SKIP  provider check (no Supabase credentials in this environment)');
  } else {
    const settings = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: anonKey },
    })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);

    const googleEnabled = settings?.external?.google === true;

    /*
      Read from the catalogue rather than spelled out here.

      This looked for "المتابعة بجوجل" and the button says "المتابعة باستخدام
      Google", so the check could never have passed — and nobody noticed,
      because the whole section skips itself when the Supabase credentials are
      absent from the environment, which they were every time it ran. A test
      that only runs where it cannot fail is not a test. `pnpm smoke` loads
      .env.local now, and the label comes from the same file the page renders.
    */
    const { continueWithGoogle } = JSON.parse(
      read(new URL('../messages/ar.json', import.meta.url), 'utf8'),
    ).auth;

    for (const path of ['/sign-in', '/sign-up', '/sign-in/candidate', '/sign-up/employer']) {
      const { body } = await get(path);
      const offered = body.includes(continueWithGoogle);
      check(
        `${path} offers Google only when it is enabled`,
        offered === googleEnabled,
        `button ${offered ? 'shown' : 'hidden'}, provider ${googleEnabled ? 'on' : 'off'}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
section('a locked-out user has a way back in');
{
  // The site carried the words for a password reset — auth.forgotPassword and
  // two more — for months without carrying the reset. These assert the door
  // exists and is reachable from where somebody stuck would look for it.
  const forgot = await get('/sign-in/forgot');
  check('/sign-in/forgot -> 200', forgot.status === 200, `got ${forgot.status}`);
  check('and asks for an email', /name="email"/.test(forgot.body));

  // Matched on the path, not on `href="…"`. These routes stream, so whether a
  // link arrives as literal markup or inside an RSC payload depends on where
  // the first flush lands — and that moved when the site header changed
  // layouts. The path appears either way; the attribute does not.
  const signIn = await get('/sign-in');
  check('sign-in links to it', signIn.body.includes('/sign-in/forgot'));

  // A static segment has to beat /sign-in/[audience], which would otherwise
  // treat "forgot" as an unknown audience and 404.
  const bogus = await get('/sign-in/recruiter');
  check('while an unknown audience still 404s', bogus.status === 404, `got ${bogus.status}`);

  const setter = await get('/sign-in/new-password');
  check('/sign-in/new-password -> 200', setter.status === 200, `got ${setter.status}`);
  check(
    'and offers no password field without a session',
    !/type="password"/.test(setter.body) && setter.body.includes('/sign-in/forgot'),
  );
}

// ---------------------------------------------------------------------------
section('every page announces what it is');
{
  // Written after finding three pages — /admin/companies, /admin/reports and
  // /admin/jobs — that rendered with no h1 at all and the site's default
  // <title>, so a screen reader landing on the verification queue was told
  // only the name of the website. Each queue was reachable and worked, and
  // said nothing about where you were.
  //
  // Those three are behind a session, so this loop cannot reach them; they
  // were fixed by hand. What it does is stop the same thing happening on the
  // public site, which is where it would cost readers and search engines.
  //
  // Only markup-level checks live here. Contrast and tap-target size need
  // layout, which needs a browser; they are measured against a running build
  // rather than faked with a regex.
  const strip = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

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
    const { body } = await get(path);

    const h1s = body.match(/<h1[\b >]/g) ?? [];
    check(`${path} has exactly one h1`, h1s.length === 1, `found ${h1s.length}`);

    const title = strip(body.match(/<title[^>]*>(.*?)<\/title>/s)?.[1] ?? '');
    // Every page's title is "<page> | <site>" or, for the home page, the site
    // name plus its tagline. A title with neither separator is a page that
    // never set one and fell through to the layout default.
    check(`${path} has its own <title>`, /[|—]/.test(title), title || '(none)');

    // A decorative image declares itself with alt="", so the check is for the
    // attribute's presence, not its content.
    const imgs = body.match(/<img\b[^>]*>/g) ?? [];
    const unlabelled = imgs.filter((tag) => !/\balt=/.test(tag));
    check(`${path} labels every img`, unlabelled.length === 0, unlabelled[0]?.slice(0, 90));

    const ids = [...body.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    check(`${path} has no duplicate ids`, dupes.length === 0, [...new Set(dupes)].join(', '));
  }
}

// ---------------------------------------------------------------------------
section('the marketing header appears once, and only where it belongs');
{
  // It used to live in the root layout and hide itself from the console with a
  // hand-written list of path prefixes. The list drifted the moment
  // /notifications joined the (app) group, and that page rendered the
  // marketing header stacked on the console's own — two headers deep. The
  // header now belongs to the (site) layout, so the console cannot inherit
  // one; these assert the public and auth halves of that.
  const headers = (body) => (body.match(/group\/header/g) ?? []).length;

  for (const path of ['/', '/jobs', '/companies', '/agents', '/blog', '/employers']) {
    const { body } = await get(path);
    check(`${path} renders exactly one site header`, headers(body) === 1, `found ${headers(body)}`);
  }

  for (const path of ['/sign-in', '/sign-up', '/sign-in/candidate', '/sign-up/employer']) {
    const { body } = await get(path);
    check(`${path} renders none`, headers(body) === 0, `found ${headers(body)}`);
  }
}

// ---------------------------------------------------------------------------
section('a URL with no record behind it is never indexable');
{
  // These stream, so Next cannot send a 404 after the headers are gone — the
  // status is a soft 404 and stays one unless the skeletons go. What actually
  // keeps them out of the index is the noindex, so that is what is asserted.
  // /blog is the control: no loading.tsx, no streaming, a real 404.
  for (const path of [
    '/jobs/no-such-listing',
    '/companies/no-such-company',
    '/agents/no-such-consultant',
  ]) {
    const { body } = await get(path);
    check(`${path} is served noindex`, /<meta name="robots" content="noindex/.test(body));
  }

  const blog = await get('/blog/no-such-post');
  check('/blog/* still returns a real 404', blog.status === 404, `got ${blog.status}`);
}

// ---------------------------------------------------------------------------
section('the closed English side stays closed');
{
  const en = await get('/en/jobs');
  check('/en/* redirects', en.status === 307, `got ${en.status}`);
}

// ---------------------------------------------------------------------------
section('the board holds its shape under a hostile query string');
{
  /*
    Round 3's search and pagination work, kept honest at the HTTP boundary
    where it actually broke. `?page=400` did not render an empty board — it
    returned a 500 carrying PostgREST's own sentence about offsets, because a
    range past the end of a result set is refused outright rather than
    answered with nothing.
  */
  const first = await get('/jobs?page=1');
  const past = await get('/jobs?page=99999');

  check('a page past the end is still a page', past.status === 200, `got ${past.status}`);
  check(
    'and it is the last one, not an error',
    !/PGRST|Requested range|searching jobs/.test(past.body),
    'the response carried a database error',
  );

  const cards = (body) => (body.match(/\/jobs\/[a-z0-9-]+-\d{6}/g) ?? []).length;
  check(
    `it renders listings rather than "nothing matches" (${cards(past.body)} of ${cards(first.body)})`,
    cards(past.body) > 0 && cards(past.body) === cards(first.body),
  );

  /*
    The directory had the same bug and was never revisited.

    Its total rides along on each row as `count(*) over ()`, so a page with no
    rows carried no total — and `?page=99` reported zero consultants and
    rendered "مفيش استشاريين مطابقين لبحثك" on an unfiltered directory of
    seven people. Not a 500 like the board's, which is why nobody noticed: a
    confident empty state is quieter than an error and says something false.
  */
  const agentsFirst = await get('/agents?page=1');
  const agentsPast = await get('/agents?page=99');
  const agentCards = (body) => new Set(body.match(/\/agents\/[a-z0-9-]+-\d{6}/g) ?? []).size;

  check('a directory page past the end is still a page', agentsPast.status === 200, `got ${agentsPast.status}`);
  check(
    `and it shows consultants rather than "nobody matches" (${agentCards(agentsPast.body)} of ${agentCards(agentsFirst.body)})`,
    agentCards(agentsPast.body) > 0 && agentCards(agentsPast.body) === agentCards(agentsFirst.body),
  );

  for (const [term, label] of [
    ['"unbalanced', 'an unbalanced quote'],
    ['a | b', 'a tsquery operator'],
    ['<script>alert(1)</script>', 'a script tag'],
    ['%', 'a wildcard'],
    ['ا'.repeat(400), 'a four-hundred-character word'],
  ]) {
    const { status, body } = await get(`/jobs?q=${encodeURIComponent(term)}`);
    check(`${label} in the search renders a board`, status === 200 && !/PGRST|syntax error/.test(body));
    if (term.includes('<script>')) {
      check('and is not reflected as markup', !body.includes('<script>alert(1)</script>'));
    }
  }

  const negative = await get('/jobs?page=-5');
  const alpha = await get('/jobs?page=abc');
  check('a negative page is page one', negative.status === 200 && cards(negative.body) === cards(first.body));
  check('so is a page that is not a number', alpha.status === 200 && cards(alpha.body) === cards(first.body));
}

// ---------------------------------------------------------------------------
section('the public API refuses what the pages refuse');
{
  /*
    The anon key is public by design — it ships in the browser bundle — so
    every row-level rule this product has is reachable directly, without the
    application in front of it. These are the same probes prompt 7 ran as SQL,
    at the boundary a stranger would actually use.
  */
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    check('skipped: no Supabase URL or anon key in the environment', true);
  } else {
    const rest = async (path, method = 'GET') => {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
      });
      const text = await response.text().catch(() => '');
      return { status: response.status, rows: text.startsWith('[') ? JSON.parse(text).length : null };
    };

    for (const [table, what] of [
      ['applications', 'applications'],
      ['profiles?select=whatsapp_phone', 'phone numbers'],
      ['company_documents', 'verification documents'],
      ['orders', 'the order history'],
      ['email_log', 'the email log'],
      ['notifications', 'notifications'],
      ['application_events', 'application history'],
      ['jobs?status=eq.draft', 'draft listings'],
    ]) {
      const { status, rows } = await rest(`/rest/v1/${table}${table.includes('?') ? '&' : '?'}select=*`);
      check(`a stranger reads no ${what}`, status === 200 && rows === 0, `status ${status}, ${rows} rows`);
    }

    const apply = await rest('/rest/v1/applications', 'POST');
    check('and cannot apply', apply.status >= 400, `status ${apply.status}`);

    const post = await rest('/rest/v1/jobs', 'POST');
    check('nor post a listing', post.status >= 400, `status ${post.status}`);

    /*
      A PATCH that changes nothing answers 204 with no body, which is the
      correct shape for "row-level security filtered this to zero rows" — so
      the assertion that matters is not the status, it is that the board is
      exactly as long afterwards.
    */
    const liveBefore = await rest('/rest/v1/jobs?select=id&status=eq.active');
    await rest('/rest/v1/jobs?status=eq.active', 'PATCH');
    const liveAfter = await rest('/rest/v1/jobs?select=id&status=eq.active');
    check('nor close every listing on the board',
      liveBefore.rows != null && liveBefore.rows === liveAfter.rows,
      `${liveBefore.rows} listings before, ${liveAfter.rows} after`);

    // The one thing they may read: a consultant who chose to be public.
    const directory = await rest('/rest/v1/agent_profiles?select=slug&visibility=eq.public');
    check('a public consultant is public', directory.status === 200 && (directory.rows ?? 0) > 0);

    const gated = await rest('/rest/v1/agent_profiles?select=slug&visibility=neq.public');
    check('and everyone else is not', gated.status === 200 && gated.rows === 0, `${gated.rows} rows`);
  }
}

// ---------------------------------------------------------------------------
section('the directory names nobody it should not');
{
  const list = await get('/agents');
  check('the consultant directory renders', list.status === 200);

  /*
    An anonymous visitor sees gated cards without a name — search_agents()
    returns null for full_name unless the viewer is a verified employer. The
    page says so in words, which is what this looks for: if the gate ever
    stopped applying, the anonymous label would stop appearing while the cards
    stayed.
  */
  /*
    The six-digit suffix is the slug builder's, and it is what separates a real
    consultant from `/agents/agent-card` — a chunk filename that appears in the
    RSC payload and matched a looser pattern, quietly turning four of these
    assertions into checks that the not-found page renders.
  */
  const slugs = [
    ...new Set([...list.body.matchAll(/\/agents\/([a-z0-9-]+-\d{6})\b/g)].map((m) => m[1])),
  ];
  check(`found consultants to open (${slugs.length})`, slugs.length > 0);

  for (const slug of slugs.slice(0, 6)) {
    const { status, body } = await get(`/agents/${slug}`);
    check(`/agents/${slug} renders`, status === 200, `got ${status}`);

    /*
      A gated card carries no WhatsApp link. That is the assertion worth
      making: the name has a stand-in the page shows either way, but a `wa.me`
      href is unambiguous — it is either there or it is not, and for a visitor
      with no session it must not be.
    */
    check(`/agents/${slug} gives a stranger no number to call`,
      !/wa\.me\/\d/.test(body));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
