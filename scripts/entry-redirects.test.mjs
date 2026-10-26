/**
 * `/welcome` and `/mfa` never send a reader back to themselves.
 *
 *   node --experimental-strip-types scripts/entry-redirects.test.mjs
 */
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { redirectForEntry } = await import('../src/lib/auth/entry-redirects.ts');

let pass = 0;
let fail = 0;
function is(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

function pathOf(href) {
  return href.split(/[?#]/, 1)[0] || '/';
}

for (const signedIn of [false, true]) {
  for (const due of [false, true]) {
    const welcome = redirectForEntry('/welcome', '?code=abc', signedIn, due);
    is(`welcome ${signedIn} ${due} stays home`, pathOf(welcome.href), '/');
    is(`welcome ${signedIn} ${due} keeps the query`, welcome.href, '/?code=abc');
    is(`welcome ${signedIn} ${due} is permanent`, welcome.status, 308);

    const mfa = redirectForEntry('/mfa', '', signedIn, due);
    const dest = pathOf(mfa.href);
    is(`mfa ${signedIn} ${due} is temporary`, mfa.status, 307);
    is(`mfa ${signedIn} ${due} leaves the door`, dest === '/mfa' || dest === '/welcome', false);
  }
}

is('a next of /mfa is dropped', pathOf(redirectForEntry('/mfa', '?next=/mfa', true, false).href), '/dashboard/account');
is('a next of /welcome is dropped', pathOf(redirectForEntry('/mfa', '?next=/welcome', false, false).href), '/sign-in');
is(
  'a password reset goes to the new-password form',
  redirectForEntry('/mfa', '?then=new-password', false, false).href,
  '/sign-in?next=%2Fsign-in%2Fnew-password',
);
is('signed in, the reset form itself', redirectForEntry('/mfa', '?then=new-password', true, false).href, '/sign-in/new-password');
is(
  'a code that is due opens the account challenge',
  redirectForEntry('/mfa', '?next=/jobs', true, true).href,
  '/dashboard/account?mfa=challenge&next=%2Fjobs',
);
is('anything else is left alone', redirectForEntry('/jobs', '', false, false), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
