/**
 * An account with an authenticator, signed in with the password alone, on the
 * website: sent to the code from every page of the account, and back to that
 * page once it is answered.
 *
 *   node --experimental-strip-types scripts/second-factor.test.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { secondFactorChallenge } = await import('../src/lib/auth/second-factor.ts');
const { safeNext } = await import('../src/lib/safe-next.ts');

const ROOT = join(import.meta.dirname, '..');
let pass = 0;
let fail = 0;
function is(label, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

console.log('\n— where a page of the account sends it');
const toApplications = secondFactorChallenge('/dashboard/applications', '?status=new');
is('to the account page, in challenge mode', toApplications?.split('?')[0], '/dashboard/account');
const params = new URLSearchParams(toApplications?.split('?')[1] ?? '');
is('asking for the code', params.get('mfa'), 'challenge');
is('carrying the page it was on its way to, with its query', params.get('next'), '/dashboard/applications?status=new');
is('which the account page accepts as a destination of ours', safeNext(params.get('next')), '/dashboard/applications?status=new');
is('the employer area too', new URLSearchParams(secondFactorChallenge('/employer/jobs', '')?.split('?')[1]).get('next'), '/employer/jobs');
is('never from the account page itself, which draws the challenge', secondFactorChallenge('/dashboard/account', '?mfa=challenge'), null);

console.log('\n— the pages that make it so');
const middleware = readFileSync(join(ROOT, 'src/middleware.ts'), 'utf8');
is(
  'the middleware asks only for an account page, signed in, with the factor due',
  /needsAuth && user && secondFactorDue \? secondFactorChallenge\(path, request\.nextUrl\.search\)/.test(middleware),
  true,
);
const page = readFileSync(join(ROOT, 'src/app/[locale]/(app)/dashboard/account/page.tsx'), 'utf8');
is(
  'the account page draws the challenge alone while the factor is due',
  /if \(mfaEnrolled && mfaLevel === 'aal1'\) \{[\s\S]*?return \([\s\S]*?<MfaSettings locale=\{locale\} enrolled level="aal1"/.test(page),
  true,
);
is(
  "with the admin console's banner for an admin only, now that every account is asked",
  /<MfaSettings locale=\{locale\} enrolled level="aal1" mode=\{isAdmin \? 'challenge' : null\}/.test(page),
  true,
);
is(
  'and a way to a person for someone without the phone',
  /if \(mfaEnrolled && mfaLevel === 'aal1'\) \{[\s\S]*?t\.rich\('mfaLost'/.test(page),
  true,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
