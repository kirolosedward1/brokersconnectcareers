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
const { knownAuthError, passwordRefusal } = await import('../src/lib/auth/errors.ts');

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

console.log('\n— a password change GoTrue refused, read as what it asks for');
const aal = { code: 'insufficient_aal', message: 'AAL2 session is required to update email or password when MFA is enabled.' };
is('the authenticator, not "that link has expired"', passwordRefusal(aal), 'second_factor');
is('the same from an older server with no code', passwordRefusal({ message: aal.message }), 'second_factor');
is('a code by email, on a session a day old', passwordRefusal({ code: 'reauthentication_needed', message: 'Password update requires reauthentication' }), 'reauthenticate');
is('the same with no code', passwordRefusal({ message: 'Password update requires reauthentication' }), 'reauthenticate');
is('a wrong emailed code', passwordRefusal({ code: 'reauthentication_not_valid', message: 'Nonce has expired or is invalid' }), 'code_invalid');
is('a spent emailed code', passwordRefusal({ code: 'otp_expired', message: 'Token has expired or is invalid' }), 'code_invalid');
is('no session left is still the spent link', passwordRefusal({ name: 'AuthSessionMissingError', message: 'Auth session missing!' }), 'session');
is('and an account deleted under the session, as before codes decided', passwordRefusal({ code: 'user_not_found', message: 'User from sub claim in JWT does not exist' }), 'session');
is('as is a session the server no longer has', passwordRefusal({ code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist' }), 'session');
is('anything else is not called an expired link', passwordRefusal({ code: 'weak_password', message: 'Password should be at least 10 characters.' }), 'other');
const same = { code: 'same_password', message: 'New password should be different from the old password.' };
is('the same password again is not an expired link', passwordRefusal(same), 'other');
is('and has its own words in the shared mapping', knownAuthError(same)?.key, 'errSamePassword');
is('too many tries is not an expired link', passwordRefusal({ code: 'over_request_rate_limit', message: 'Request rate limit reached' }), 'other');
is('a refusal with nothing in it is other', passwordRefusal({}), 'other');
is('nor is a missing message mistaken for a session', passwordRefusal({ code: 'unexpected_failure' }), 'other');
is(
  "the code's own refusal (no address to send it to) is not a wrong code",
  passwordRefusal({ code: 'validation_failed', message: 'Reauthentication requires the user to have an email or a phone number' }),
  'other',
);

console.log('\n— the code decides when there is one; the prose only when there is none');
is(
  "an unlisted code is not read from its prose (a coded error that mentions 'session' is not a spent link)",
  passwordRefusal({ code: 'unexpected_failure', message: 'Database error loading session' }),
  'other',
);
is('the client-side errors carry no code, and are still read from their prose', passwordRefusal({ name: 'AuthSessionMissingError', message: 'Auth session missing!' }), 'session');

console.log('\n— a password over 72 characters is said as that, not as a bad email address');
const tooLong = { code: 'validation_failed', message: 'Password cannot be longer than 72 characters' };
is('GoTrue\'s refusal, by code', knownAuthError(tooLong)?.key, 'passwordLong');
is('and by its prose alone', knownAuthError({ message: tooLong.message })?.key, 'passwordLong');
is('a malformed address under the same code is still the email', knownAuthError({ code: 'validation_failed', message: 'Unable to validate email address: invalid format' })?.key, 'invalidEmail');

console.log('\n— the reset and the settings ask for it');
const resetPage = readFileSync(join(ROOT, 'src/app/[locale]/sign-in/new-password/page.tsx'), 'utf8');
is(
  'the reset page sends an account with an authenticator to the code before the form',
  /!assuranceError && assurance\?\.currentLevel === 'aal1' && assurance\.nextLevel === 'aal2'\) \{\s*redirect\(\{ href: secondFactorChallenge\('\/sign-in\/new-password', ''\)/.test(resetPage),
  true,
);
is(
  'and the account page accepts the reset form as where to come back to',
  safeNext(new URLSearchParams(secondFactorChallenge('/sign-in/new-password', '')?.split('?')[1]).get('next')),
  '/sign-in/new-password',
);
const resetForm = readFileSync(join(ROOT, 'src/components/auth/new-password-form.tsx'), 'utf8');
is('the reset form no longer reads GoTrue\'s prose for itself', /\/session\|jwt\|expired\//.test(resetForm), false);
is("and goes to the code when GoTrue asks for it", /refusal === 'second_factor'[\s\S]*?secondFactorChallenge\('\/sign-in\/new-password'/.test(resetForm), true);
const settings = readFileSync(join(ROOT, 'src/components/dashboard/credentials-settings.tsx'), 'utf8');
is(
  'the settings ask for an emailed code when GoTrue wants one',
  /if \(refusal === 'reauthenticate' \|\| \(refusal === 'code_invalid' && !nonce\)\) \{\s*await sendCode\(\);/.test(settings) &&
    /async function sendCode\(\) \{\s*const \{ error \} = await createClient\(\)\.auth\.reauthenticate\(\);/.test(settings),
  true,
);
is(
  'and send nothing while the code asked for is empty, rather than email another',
  /if \(codeSent && !nonce\) \{\s*setPasswordError\(tValidation\('required'\)\);\s*return;/.test(settings),
  true,
);
is('and send it back as the nonce', /updateUser\(nonce \? \{ password, nonce \} : \{ password \}\)/.test(settings), true);

console.log('\n— any other refusal is said in the shared words, not as "something went wrong"');
is(
  'the reset form says a known refusal (the same password again, one too weak) in its own words',
  /const known = knownAuthError\(updateError\);[\s\S]*?setError\(\s*refusal === 'session'\s*\? t\('linkExpired'\)\s*: known/.test(resetForm),
  true,
);
is(
  'and so do the settings, for the password and for the code',
  (settings.match(/said\(error\)/g) ?? []).length === 2 && /function said\(error: \{ message: string; code\?: string \}\)/.test(settings),
  true,
);
is('the settings no longer single out one refusal', /knownAuthError\(error\)\?\.key === 'passwordShort'/.test(settings), false);

console.log('\n— a code GoTrue has taken is not offered again');
is(
  'the website treats a code refused for anything but itself as spent, and asks afresh',
  /if \(nonce && refusal !== 'code_invalid' && isAuthApiError\(error\)\) setCodeSent\(false\);/.test(settings),
  true,
);

console.log('\n— the authenticator code on the website takes an Arabic keyboard\'s digits');
const mfa = readFileSync(join(ROOT, 'src/components/dashboard/mfa-settings.tsx'), 'utf8');
is('the code is read through westernDigits', /westernDigits\(String\(new FormData\(event\.currentTarget\)\.get\('code'\)/.test(mfa), true);
is('and no field holds it to ASCII digits', /pattern="\[0-9\]\{6\}"/.test(mfa), false);
is(
  'a code sent before the page knows its factor asks for the factor, rather than calling the code wrong',
  /const id = factorId \?\? \(await accountFactorId\(supabase\)\);/.test(mfa) && !/!factorId \|\|/.test(mfa),
  true,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
