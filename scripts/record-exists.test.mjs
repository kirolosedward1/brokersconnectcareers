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
import { detailTargets, recordState } from '../src/lib/seo/record-exists.ts';
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

/** A fake REST API: `present` is the set of `table:value` rows that exist. */
const api = (present, { status = 200, throws = false } = {}) => async (url) => {
  if (throws) throw new Error('network');
  const u = new URL(url);
  const table = u.pathname.split('/').pop();
  const value = [...u.searchParams.entries()].map(([, v]) => v.replace(/^eq\./, '')).find((v) => v !== 'id' && v !== 'slug' && v !== '1');
  const rows = present.has(`${table}:${value}`) ? [{}] : [];
  return new Response(JSON.stringify(rows), { status });
};
const state = (path, present, opts) => recordState(path, parseLandingSlug, api(new Set(present), opts));

console.log('— which paths are checked');
is('not a detail page', detailTargets('/jobs', parseLandingSlug), null);
is('a sub-page is left alone', detailTargets('/jobs/x-123456/apply', parseLandingSlug), null);
is('a listing', detailTargets('/jobs/sales-new-cairo-123456', parseLandingSlug).map((t) => t.table), ['jobs']);
is('a landing page asks about the district and a listing',
  detailTargets('/jobs/primary-sales-new-cairo', parseLandingSlug).map((t) => t.table), ['districts', 'jobs']);
is('a gated profile is asked through the page\'s own function', 'rpc' in detailTargets('/agents/a-1', parseLandingSlug)[0], true);
is('a malformed escape is not checked', detailTargets('/jobs/%E0%A4%A', parseLandingSlug), null);

console.log('\n— what must not 404');
is('a live listing', await state('/jobs/sales-new-cairo-123456', ['jobs:sales-new-cairo-123456']), 'exists');
is('a listing whose title starts with a track',
  await state('/jobs/commercial-consultant-nasr-city-890956', ['jobs:commercial-consultant-nasr-city-890956']), 'exists');
is('a landing page for a real district', await state('/jobs/primary-sales-new-cairo', ['districts:new-cairo']), 'exists');
is('an Arabic slug, decoded', await state('/companies/%D8%A7', ['companies:ا']), 'exists');
is('the API erroring', await state('/jobs/x-123456', [], { status: 500 }), 'unknown');
is('the network failing', await state('/jobs/x-123456', [], { throws: true }), 'unknown');

console.log('\n— what does');
is('a listing nobody can see', await state('/jobs/gone-123456', []), 'missing');
is('a landing page for no district, which is no listing either', await state('/jobs/primary-sales-atlantis', []), 'missing');
is('a company that is not there', await state('/companies/nope', []), 'missing');
is('a hidden profile', await state('/agents/hidden-1', []), 'missing');

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
is('unconfigured is never missing', await state('/jobs/gone-123456', []), 'unknown');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
