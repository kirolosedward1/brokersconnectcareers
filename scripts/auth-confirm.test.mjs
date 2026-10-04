/**
 * The email links and the page they land on, held to one contract.
 *
 *   node --experimental-strip-types scripts/auth-confirm.test.mjs
 *
 * The templates (scripts/auth-templates.mjs → supabase/templates) write a link
 * to /auth/confirm; src/lib/auth/confirm-link.ts reads it, on the website and
 * in the app. This takes each generated template, fills in GoTrue's variables
 * the ways GoTrue might (the redirect raw, or escaped whole), and checks the
 * page ends up at the destination the form asked for — plus the reader's
 * rules on their own, and the route's two safety properties read off its
 * source: a GET never spends a link, and a POST from another site is refused.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { asConfirmType, confirmDestination, isTokenHash, landingFromRedirect, readRedirectTo } = await import(
  '../src/lib/auth/confirm-link.ts'
);

const ROOT = join(import.meta.dirname, '..');
const SITE = 'https://www.brokersconnect.net';

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

// The confirmation redirect the sign-up form builds (auth-form.tsx): the
// callback, carrying the onboarding step, itself carrying the page after it.
const onboarding = '/onboarding?role=employer&confirmed=1&next=%2Fjobs%2Fsales-a1b2';
const formRedirect = `${SITE}/auth/callback?next=${encodeURIComponent(onboarding)}`;

console.log('— redirect_to is read whole, raw or escaped');
is('raw, with its own query intact', readRedirectTo(`?token_hash=abc&type=email&redirect_to=${formRedirect}`), formRedirect);
is('escaped as a whole, decoded once', readRedirectTo(`token_hash=abc&type=email&redirect_to=${encodeURIComponent(formRedirect)}`), formRedirect);
// What Next hands the route: the query parsed and written back out, so the
// redirect arrives escaped once more and its own `next` decoded once less.
const renormalized = new URLSearchParams({ token_hash: 'abc', type: 'email', redirect_to: formRedirect }).toString();
is('re-escaped by the framework, still whole', landingFromRedirect(readRedirectTo(renormalized), SITE), onboarding);
is('absent', readRedirectTo('token_hash=abc&type=email'), null);
is('empty', readRedirectTo('token_hash=abc&type=email&redirect_to='), null);
is('only the parameter itself, not one ending in its name', readRedirectTo('xredirect_to=https://evil.example'), null);
is('a malformed escape is not guessed at', readRedirectTo('redirect_to=https%3A%2F%2F%E0%A4%A'), null);

console.log('\n— where the link may send somebody');
is('the callback wrapper comes off', landingFromRedirect(formRedirect, SITE), onboarding);
is('any other page on this site', landingFromRedirect(`${SITE}/jobs/sales-a1b2?src=share`, SITE), '/jobs/sales-a1b2?src=share');
is('a bare path', landingFromRedirect('/dashboard/saved', SITE), '/dashboard/saved');
is('the Site URL alone is no preference', landingFromRedirect(SITE, SITE), null);
is('another site is nowhere', landingFromRedirect('https://evil.example/dashboard', SITE), null);
is('a look-alike host is nowhere', landingFromRedirect('https://www.brokersconnect.net.evil.example/', SITE), null);
is("the app's scheme is not the website's to follow", landingFromRedirect('brokersconnect://auth/callback?next=/dashboard', SITE), null);
is('a hostile next inside the wrapper is refused', landingFromRedirect(`${SITE}/auth/callback?next=//evil.example`, SITE), null);
is('javascript: is nowhere', landingFromRedirect('javascript:alert(1)', SITE), null);
is('nothing is nowhere', landingFromRedirect(null, SITE), null);

console.log('\n— each kind of link, and where it goes when it names nowhere');
is('a reset always goes to the new-password form', confirmDestination('recovery', formRedirect, SITE), '/sign-in/new-password');
is('an email change goes where it asked', confirmDestination('email_change', `${SITE}/dashboard/account?x=1`, SITE), '/dashboard/account?x=1');
is('or to the account page', confirmDestination('email_change', SITE, SITE), '/dashboard/account');
is('a confirmation goes where the form asked', confirmDestination('email', formRedirect, SITE), onboarding);
is('or leaves it to the sign-in landing', confirmDestination('email', null, SITE), null);

console.log('\n— what the route accepts');
for (const type of ['signup', 'email', 'invite', 'magiclink', 'recovery', 'email_change']) is(`type ${type}`, asConfirmType(type), type);
is('an unknown type', asConfirmType('sms'), null);
is('no type', asConfirmType(null), null);
is('a hex token hash', isTokenHash('a'.repeat(56)), true);
is('a pkce token hash', isTokenHash(`pkce_${'b'.repeat(56)}`), true);
is('something shorter than a hash', isTokenHash('abc'), false);
is('something with markup in it', isTokenHash(`${'a'.repeat(20)}"><script>`), false);

console.log('\n— every template, filled in the ways GoTrue might, lands where it should');
const templates = [
  ['confirmation.html', 'email', formRedirect, onboarding],
  ['magic-link.html', 'email', `${SITE}/auth/callback?next=%2Fdashboard`, '/dashboard'],
  ['recovery.html', 'recovery', `${SITE}/auth/callback?next=/sign-in/new-password`, '/sign-in/new-password'],
  ['email-change.html', 'email_change', SITE, '/dashboard/account'],
];
for (const [file, wantType, redirectTo, destination] of templates) {
  const html = readFileSync(join(ROOT, 'supabase', 'templates', file), 'utf8');
  const hrefs = [...html.matchAll(/href="([^"]*\/auth\/confirm[^"]*)"/g)].map((match) => match[1].replace(/&amp;/g, '&'));
  is(`${file} links to /auth/confirm`, hrefs.length > 0, true);
  for (const [how, filled, renormalize] of [
    ['raw', redirectTo, false],
    ['escaped', encodeURIComponent(redirectTo), false],
    ['raw, then re-escaped on the way in', redirectTo, true],
    ['escaped, then re-escaped on the way in', encodeURIComponent(redirectTo), true],
  ]) {
    let link = new URL(hrefs[0].replace('{{ .TokenHash }}', 'c'.repeat(56)).replace('{{ .RedirectTo }}', filled));
    if (renormalize) link = new URL(`${link.origin}${link.pathname}?${new URLSearchParams(link.searchParams).toString()}`);
    const type = asConfirmType(link.searchParams.get('type'));
    is(`${file} (${how}): the type`, type, wantType);
    is(`${file} (${how}): the token`, isTokenHash(link.searchParams.get('token_hash')), true);
    is(`${file} (${how}): the destination`, confirmDestination(type, readRedirectTo(link.search), SITE), destination);
  }
}

console.log('\n— the route: a GET never spends a link, a POST from elsewhere is refused');
const route = readFileSync(join(ROOT, 'src', 'app', 'auth', 'confirm', 'route.ts'), 'utf8');
const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'));
const post = route.slice(route.indexOf('export async function POST'));
is('GET does not verify the token', /verifyOtp/.test(get), false);
is('POST verifies it', /verifyOtp\(\{ type, token_hash: tokenHash \}\)/.test(post), true);
is('POST checks where it came from before reading anything', post.indexOf('sameOrigin(request)') < post.indexOf('formData()'), true);
// 303 See Other, so the browser follows a form post with a GET.
is(
  'every redirect after a POST is a 303',
  (post.match(/NextResponse\.redirect\(/g) ?? []).length === (post.match(/, 303\)/g) ?? []).length &&
    /function linkFailed[\s\S]*?, 303\)/.test(route),
  true,
);
is('the page is never cached or indexed', /'cache-control': 'no-store'/.test(route) && /noindex/.test(route), true);

console.log('\n— signing out on the website');
{
  // supabase-js signs every session out unless told otherwise, the phone's
  // included: someone signing out of the website at work found the app signed
  // out too. A person's own "sign out" is this browser's, as the app's is that
  // phone's; ending the others belongs to a password change ('others'), and an
  // account deleted has nothing left to keep (src/lib/actions/account.ts).
  const files = readdirSync(join(ROOT, 'src', 'components'), { recursive: true }).filter((file) =>
    String(file).endsWith('.tsx'),
  );
  const bare = files.filter((file) => /auth\.signOut\(\s*\)/.test(readFileSync(join(ROOT, 'src', 'components', String(file)), 'utf8')));
  is('no component signs every session out', bare, []);
  const local = files.filter((file) =>
    /auth\.signOut\(\{ scope: 'local' \}\)/.test(readFileSync(join(ROOT, 'src', 'components', String(file)), 'utf8')),
  );
  is('the menus and onboarding sign this browser out', local.length >= 3, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
