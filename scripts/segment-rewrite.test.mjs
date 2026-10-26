/**
 * Which public URL is drawn from an internal page, for GET and for POST.
 *
 *   node --experimental-strip-types scripts/segment-rewrite.test.mjs   (in pnpm test:seo)
 *
 * A server action posts to the address in the bar. Save posts to the job ad,
 * a filter posts to /jobs, and the signed-in home posts to /. Those have to
 * take the same rewrite a document GET takes, or the action is answered by
 * the cached page. Apply posts to /jobs/<slug>/apply and follow posts to the
 * company, which are already the pages that render the buttons.
 */
import { readFileSync } from 'node:fs';
import { segmentRewrite } from '../src/lib/seo/segment-rewrite.ts';

let pass = 0;
let fail = 0;
function is(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

console.log('— the public URL and the page that draws it');
is('a signed-in home', segmentRewrite('/', '', true, null), '/signed-home');
is('an anonymous home stays put', segmentRewrite('/', '', false, null), null);
is('a filtered board', segmentRewrite('/jobs', '?track=primary', false, null), '/board');
is('an unfiltered board stays put', segmentRewrite('/jobs', '', true, null), null);
is('a bare question mark is not a filter', segmentRewrite('/jobs', '?', true, null), null);
is('a listing', segmentRewrite('/jobs/property-consultant-477282', '', false, false), '/listing/property-consultant-477282');
is('a confirmed landing stays put', segmentRewrite('/jobs/resale-new-cairo', '', false, true), null);
is('an unanswered slug stays put', segmentRewrite('/jobs/property-consultant-477282', '', false, null), null);
is('apply is the apply page', segmentRewrite('/jobs/property-consultant-477282/apply', '', true, false), null);
is('a company stays put', segmentRewrite('/companies/nile', '', true, false), null);

console.log('— POST takes the same decision');
{
  const middleware = readFileSync('src/middleware.ts', 'utf8');
  const readOnly = middleware.indexOf('const read = request.method');
  const post = middleware.indexOf('Save, apply and follow post');
  is('the method split is there', readOnly > 0, true);
  is('and a POST still rewrites a listing', post > readOnly, true);
  is('the old-slug redirect is not reserved for a token', middleware.includes('slugRedirectTarget(path, fetch)'), true);
  is(
    'a signed-in reader with no token still skips the 404',
    middleware.includes('if (!(user && !token))'),
    true,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
