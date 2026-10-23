/**
 * Which detail URLs the middleware answers with a real 404.
 *
 *   node --experimental-strip-types scripts/record-exists.test.mjs
 *
 * The rule is narrow on purpose: missing only when every record the path
 * could name is definitely absent, and never on a failure to get an answer.
 * A wrong "missing" is a live listing served as a 404 to Google, so the
 * cases that matter most are the ones that must NOT 404.
 */
import { detailTargets, goneRewritePath, recordState } from '../src/lib/seo/record-exists.ts';
import { parseLandingSlug } from '../src/lib/taxonomy.ts';

let pass = 0;
let fail = 0;
function is(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';

/**
 * A fake REST API. `present` is a Set of `table:value` keys (the row is `{}`,
 * which is a listing with no status and so still exists) or a Map of those
 * keys to the row the select would return.
 */
const api = (present, { status = 200, throws = false } = {}) => async (url) => {
  if (throws) throw new Error('network');
  const u = new URL(url);
  const table = u.pathname.split('/').pop();
  const values = [...u.searchParams.values()];
  const eq = values.find((value) => value.startsWith('eq.'));
  const value = eq
    ? eq.slice(3)
    : values.find((item) => item !== 'id' && item !== 'slug' && item !== '1' && !item.includes(','));
  const key = `${table}:${value}`;
  const row = present instanceof Map ? (present.has(key) ? present.get(key) : null) : present.has(key) ? {} : null;
  return new Response(JSON.stringify(row ? [row] : []), { status });
};
const state = (path, present, opts) =>
  recordState(path, parseLandingSlug, api(present instanceof Map ? present : new Set(present), opts));

console.log('— which paths are checked');
is('not a detail page', detailTargets('/jobs', parseLandingSlug), null);
is('an application names its listing', detailTargets('/jobs/x-123456/apply', parseLandingSlug).map((t) => t.table), ['jobs']);
is('an expired listing is drawn on a real route', goneRewritePath('ar', '/jobs/old-123456'), '/ar/gone/jobs/old-123456');
is('and so is applying to it', goneRewritePath('ar', '/jobs/old-123456/apply'), '/ar/gone/jobs/old-123456');
is('a listing', detailTargets('/jobs/sales-new-cairo-123456', parseLandingSlug).map((t) => t.table), ['jobs']);
is('a landing page asks about the district and a listing',
  detailTargets('/jobs/primary-sales-new-cairo', parseLandingSlug).map((t) => t.table), ['districts', 'jobs']);
is('a gated profile is asked through the page\'s own function', 'rpc' in detailTargets('/agents/a-1', parseLandingSlug)[0], true);
is('and by the handle the function takes', detailTargets('/agents/a-1', parseLandingSlug)[0].arg, 'p_handle');
is('a malformed escape is not checked', detailTargets('/jobs/%E0%A4%A', parseLandingSlug), null);

console.log('\n— what must not 404');
is('a live listing', await state('/jobs/sales-new-cairo-123456', ['jobs:sales-new-cairo-123456']), 'exists');
is('a listing whose title starts with a track',
  await state('/jobs/commercial-consultant-nasr-city-890956', ['jobs:commercial-consultant-nasr-city-890956']), 'exists');
is('a landing page for a real district', await state('/jobs/primary-sales-new-cairo', ['districts:new-cairo']), 'exists');
is('an Arabic slug, decoded', await state('/companies/%D8%A7', ['companies:ا']), 'exists');
is('the API erroring', await state('/jobs/x-123456', [], { status: 500 }), 'unknown');
is('the network failing', await state('/jobs/x-123456', [], { throws: true }), 'unknown');

console.log('\n— what has ended');
const expired = new Map([['jobs:old-123456', { status: 'expired', expires_at: '2020-01-01T00:00:00.000Z' }]]);
const lapsed = new Map([['jobs:live-123456', { status: 'active', expires_at: '2000-01-01T00:00:00.000Z' }]]);
const future = new Map([['jobs:live-123456', { status: 'active', expires_at: '2999-01-01T00:00:00.000Z' }]]);
const closed = new Map([['jobs:shut-123456', { status: 'closed', expires_at: '2000-01-01T00:00:00.000Z' }]]);
is('an expired listing', await state('/jobs/old-123456', expired), 'gone');
is('active past its date', await state('/jobs/live-123456', lapsed), 'gone');
is('active with time left', await state('/jobs/live-123456', future), 'exists');
is('closed by its owner stays a page', await state('/jobs/shut-123456', closed), 'exists');
is('applying to an expired listing', await state('/jobs/old-123456/apply', expired), 'gone');
is(
  'a landing wins over an expired listing with the same slug',
  await state(
    '/jobs/primary-sales-new-cairo',
    new Map([
      ['districts:new-cairo', {}],
      ['jobs:primary-sales-new-cairo', { status: 'expired' }],
    ]),
  ),
  'exists',
);
is(
  'a landing-shaped slug that is only an expired listing',
  await state('/jobs/primary-sales-new-cairo', new Map([['jobs:primary-sales-new-cairo', { status: 'expired' }]])),
  'gone',
);

console.log('\n— what does');
is('a listing nobody can see', await state('/jobs/gone-123456', []), 'missing');
is('a landing page for no district, which is no listing either', await state('/jobs/primary-sales-atlantis', []), 'missing');
is('a company that is not there', await state('/companies/nope', []), 'missing');
is('a hidden profile', await state('/agents/hidden-1', []), 'missing');

console.log('\n— asked as the signed-in reader');
{
  const seen = [];
  const asReader = (routes) => async (url, init) => {
    seen.push(init.headers.authorization);
    const u = new URL(url);
    const name = u.pathname.split('/').pop();
    if (name === 'can_browse_agent_directory') return new Response(JSON.stringify(routes.browse === true));
    const present = routes.present ?? [];
    const values = [...u.searchParams.values()];
    const eq = values.find((item) => item.startsWith('eq.'));
    const value = eq
      ? eq.slice(3)
      : values.find((item) => item !== 'id' && item !== 'slug' && !item.includes(','));
    const hit = present.includes(`${name}:${value}`);
    return new Response(JSON.stringify(hit ? [{ id: '1', status: 'draft' }] : []));
  };
  const asked = (path, routes) => recordState(path, parseLandingSlug, asReader(routes), 'user-token');

  is('their token is the one that asks', await asked('/jobs/zz-fake-job-000000', {}), 'missing');
  is('and it is not the anonymous key', seen[0], 'Bearer user-token');
  is('a draft they can open still exists', await asked('/jobs/draft-123456', { present: ['jobs:draft-123456'] }), 'exists');
  is('a company that is not there, signed in', await asked('/companies/no-such-company', {}), 'missing');
  is(
    'a directory reader and no such profile',
    await asked('/agents/nobody', { browse: true }),
    'missing',
  );
  is(
    'a reader who may not open the directory is not told it is missing',
    await asked('/agents/sara', { browse: false }),
    'unknown',
  );
  is('a card they may open', await asked('/agents/sara', { present: ['get_agent_card:sara'], browse: true }), 'exists');
}

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
is('unconfigured is never missing', await state('/jobs/gone-123456', []), 'unknown');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
