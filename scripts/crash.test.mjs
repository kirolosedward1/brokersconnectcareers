/**
 * A server crash's log line keeps identifiers, never content.
 *
 *   node --experimental-strip-types scripts/crash.test.mjs
 *
 * src/lib/crash.ts describes an error for src/instrumentation.ts: the route's
 * pattern, the kind of error and its code, and the digest the reader's error
 * page shows. Never the message, the path asked for, or its query.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { describeCrash } = await import('../src/lib/crash.ts');

let pass = 0;
let fail = 0;
function is(label, got, want) {
  if (got === want) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

console.log('— a crash that quotes somebody');
{
  const error = Object.assign(
    new Error('duplicate key value violates unique constraint: (email)=(mona@example.com), whatsapp +201001234567'),
    { code: '23505', digest: '2785163923' },
  );
  const detail = describeCrash(error, 'POST', {
    routePath: '/[locale]/jobs/[slug]/apply',
    routeType: 'action',
    renderSource: undefined,
  });
  const line = JSON.stringify(detail);
  is('keeps the route as a pattern', detail.route, '/[locale]/jobs/[slug]/apply');
  is('keeps the kind of error', detail.error, 'Error');
  is('keeps its code', detail.code, '23505');
  is('keeps the digest the reader was shown', detail.digest, '2785163923');
  is('keeps the method', detail.method, 'POST');
  is('never the address', line.includes('mona@'), false);
  is('never the number', line.includes('1001234567'), false);
  is('never the message', line.includes('duplicate key'), false);
}

console.log('\n— what is not ours to trust');
{
  const detail = describeCrash(Object.assign(new TypeError('x'), { digest: 'abc def <script>' }), 'GET', {
    routePath: '/ar/jobs/مدير-مبيعات?email=mona@example.com',
    routeType: 'render',
  });
  is('a concrete path loses its query and its slug', detail.route, '/ar/jobs/[…]');
  is('a digest that is not a code is dropped', detail.digest, null);
  is('the kind of error stays', detail.error, 'TypeError');
}
{
  is('a thrown string is described by its type', describeCrash('mona@example.com', 'GET', {}).error, 'string');
  is('and nothing else of it', JSON.stringify(describeCrash('mona@example.com', 'GET', {})).includes('mona'), false);
  is('null is described too', describeCrash(null, 'GET', {}).error, 'object');
  is('a code that is a sentence is dropped', describeCrash({ code: 'value (mona@example.com) refused' }, 'GET', {}).code, null);
  is('an odd method is dropped', describeCrash(new Error(), 'G E T', {}).method, null);
  is('a catch-all route keeps its pattern', describeCrash(new Error(), 'GET', { routePath: '/[locale]/[...rest]' }).route, '/[locale]/[...rest]');
}

console.log('\n— instrumentation reports through it');
{
  const source = readFileSync(new URL('../src/instrumentation.ts', import.meta.url), 'utf8');
  is('onRequestError is exported', /export const onRequestError/.test(source), true);
  is('and logs describeCrash, never the error itself', /logFailure\('crash', [^)]*describeCrash\(error/.test(source), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
