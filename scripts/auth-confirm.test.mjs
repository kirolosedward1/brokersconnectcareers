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

const { asConfirmType, confirmDestination, isSameOriginPost, isTokenHash, landingFromRedirect, readRedirectTo } = await import(
  '../src/lib/auth/confirm-link.ts'
);
const { isMissingCodeVerifier, isSignupConfirmation, linkFailureRedirect } = await import('../src/lib/auth/cross-device.ts');
const { renderEmail } = await import('../src/lib/email/components.ts');

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
is(
  'flow=signup in front of next still unwraps',
  landingFromRedirect(`${SITE}/auth/callback?flow=signup&next=${encodeURIComponent(onboarding)}`, SITE),
  onboarding,
);
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
is('the template next is the destination when the redirect names nothing', confirmDestination('email', null, SITE, '/onboarding'), '/onboarding');
is('a next with its own query is kept', confirmDestination('signup', null, SITE, '/onboarding?confirmed=1'), '/onboarding?confirmed=1');
is('the form redirect still wins over the template next', confirmDestination('email', formRedirect, SITE, '/onboarding'), onboarding);
is('a hostile next is ignored', confirmDestination('email', null, SITE, 'https://evil.example/onboarding'), null);
is('a protocol-relative next is ignored', confirmDestination('email', null, SITE, '//evil.example'), null);
is('a bare slash is no preference', confirmDestination('magiclink', SITE, SITE, '/'), null);
is('recovery ignores next', confirmDestination('recovery', null, SITE, '/onboarding'), '/sign-in/new-password');

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
    const raw = hrefs[0]
      .replaceAll('{{ .SiteURL }}', SITE)
      .replaceAll('{{ .TokenHash }}', 'c'.repeat(56))
      .replaceAll('{{ .RedirectTo }}', filled);
    let link = new URL(raw);
    if (renormalize) link = new URL(`${link.origin}${link.pathname}?${new URLSearchParams(link.searchParams).toString()}`);
    const type = asConfirmType(link.searchParams.get('type'));
    is(`${file} (${how}): the type`, type, wantType);
    is(`${file} (${how}): the token`, isTokenHash(link.searchParams.get('token_hash')), true);
    is(`${file} (${how}): the destination`, confirmDestination(type, readRedirectTo(link.search), SITE), destination);
  }
}

console.log('\n— the generated mail');
{
  const confirmation = readFileSync(join(ROOT, 'supabase', 'templates', 'confirmation.html'), 'utf8');
  const recovery = readFileSync(join(ROOT, 'supabase', 'templates', 'recovery.html'), 'utf8');
  is(
    'confirmation says one hour, in MSA',
    confirmation.includes('هذا الرابط صالح لمدة ساعة واحدة، ويعمل مرة واحدة فقط.') &&
      confirmation.includes('This link is valid for one hour, and it works only once.') &&
      confirmation.includes('أهلاً بك في بروكرز كونكت'),
    true,
  );
  is('recovery still says one hour', recovery.includes('هذا الرابط صالح لمدة ساعة، ويعمل مرة واحدة فقط.') && !recovery.includes('24 ساعة'), true);
  is('English sits under the divider', confirmation.includes('background:#E3E7EF') && confirmation.includes('lang="en"') && confirmation.includes('Confirm your email'), true);
  is(
    'footer text and footer links',
    confirmation.includes('color:#5B6475') && confirmation.includes('font-size:13px;text-decoration:underline'),
    true,
  );
  is(
    'dark mode names the card and the text, and the logo stays on white',
    /color-scheme: light dark/.test(confirmation) &&
      /prefers-color-scheme: dark/.test(confirmation) &&
      confirmation.includes('#111827') &&
      confirmation.includes('#E5E7EB') &&
      confirmation.includes('class="bc-logo"') &&
      confirmation.includes('background:#ffffff'),
    true,
  );
  is('a plain link under the button', confirmation.includes('إذا لم يظهر الزر، فافتح هذا الرابط في المتصفح:') && confirmation.includes('If the button does not appear'), true);
  const authFiles = ['confirmation.html', 'recovery.html', 'magic-link.html', 'email-change.html', 'reauthentication.html'];
  for (const file of authFiles) {
    const html = readFileSync(join(ROOT, 'supabase', 'templates', file), 'utf8');
    is(
      `${file} offers the support address and does not forbid a reply`,
      html.includes('هل تحتاج إلى مساعدة؟ راسلنا على') &&
        html.includes('Need help? Write to') &&
        html.includes('mailto:info@topsuite.net') &&
        html.includes('font-size:13px;line-height:1.7;color:#5B6475') &&
        !html.includes('عدم الرد') &&
        !html.includes('do not reply') &&
        !html.includes('يُرجى عدم الرد'),
      true,
    );
  }
  is(
    'the confirm link is SiteURL, the token hash, the type and next',
    confirmation.includes(
      '{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email&amp;next=/onboarding&amp;redirect_to={{ .RedirectTo }}',
    ),
    true,
  );

  const product = renderEmail({
    locale: 'ar',
    dir: 'rtl',
    siteName: 'بروكرز كونكت',
    preheader: 'معاينة',
    heading: 'عنوان',
    blocks: [{ kind: 'text', value: 'نص' }],
    footer: {
      contact: { lead: 'هذه الرسالة مُرسلة تلقائياً.' },
      reason: 'سبب',
      legal: [{ label: 'الخصوصية', href: `${SITE}/privacy` }],
    },
  });
  is('product mail stays light and one language', /light dark|bc-card|bc-copy|#E3E7EF/.test(product), false);
  is('product mail footer matches the auth footer', product.includes('color:#5B6475') && !product.includes('color:#9ca3af'), true);
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
// What the browser sends with the page's own form, and with a forged one.
is('a post naming this site is let in', isSameOriginPost(SITE, 'same-origin', SITE), true);
is('a post naming another site is refused', isSameOriginPost('https://evil.example', 'cross-site', SITE), false);
is('another site that leaves Sec-Fetch-Site out is still refused', isSameOriginPost('https://evil.example', null, SITE), false);
is('Origin: null from this site’s own page is let in', isSameOriginPost('null', 'same-origin', SITE), true);
is('Origin: null from a sandboxed frame elsewhere is refused', isSameOriginPost('null', 'cross-site', SITE), false);
is('Origin: null with nothing to vouch for it is refused', isSameOriginPost('null', null, SITE), false);
is('an old browser with neither header is let in', isSameOriginPost(null, null, SITE), true);
is('a post with only Sec-Fetch-Site naming another site is refused', isSameOriginPost(null, 'cross-site', SITE), false);
// The browser names this site on the page's own post only if the page lets it:
// under no-referrer it sends Origin: null, and every link was answered 403.
is('the page’s referrer policy lets its own post say where it came from', /<meta name="referrer" content="no-referrer">/.test(route), false);
is('and still tells no other site the address', /<meta name="referrer" content="same-origin">/.test(route), true);
is('the route asks isSameOriginPost', /isSameOriginPost\(request\.headers\.get\('origin'\)/.test(route), true);
is(
  'the route reads next as well as redirect_to',
  /confirmDestination\(type, readRedirectTo\(search\), origin, searchParams\.get\('next'\)\)/.test(get),
  true,
);
is('the page is never cached or indexed', /'cache-control': 'no-store'/.test(route) && /noindex/.test(route), true);

console.log('\n— a confirmation opened on another device');
{
  const missing = {
    code: 'pkce_code_verifier_not_found',
    name: 'AuthPKCECodeVerifierMissingError',
    message: 'PKCE code verifier not found in storage.',
  };
  const expired = { code: 'otp_expired', message: 'Email link is invalid or has expired' };
  const onboarding = '/onboarding?role=employer&confirmed=1';

  is('the verifier error is recognised by its code', isMissingCodeVerifier(missing), true);
  is('and by the sentence, when an older server sends only that', isMissingCodeVerifier({ message: 'both auth code and code verifier should be non-empty' }), true);
  is('an expired token is not a missing verifier', isMissingCodeVerifier(expired), false);
  is('no error is not a missing verifier', isMissingCodeVerifier(null), false);

  is('signup is a confirmation whatever it asks to open', isSignupConfirmation('signup', null), true);
  is('the template\'s email type landing on onboarding is a confirmation', isSignupConfirmation('email', '/onboarding'), true);
  is('the sign-up form\'s confirmed flag is a confirmation', isSignupConfirmation(null, onboarding), true);
  is('a magic link is not', isSignupConfirmation('email', '/dashboard'), false);
  is('a magic link with nowhere to go is not', isSignupConfirmation('email', null), false);

  is(
    'a code with no verifier and no signup marker is still the exchange error',
    linkFailureRedirect({ flow: 'code', error: missing, next: null }),
    'exchange_failed',
  );
  is(
    'an OAuth return with no next shows the error',
    linkFailureRedirect({ flow: 'code', error: missing, next: null, marker: 'oauth' }),
    'exchange_failed',
  );
  is(
    'OAuth never shows the notice, even when next looks like onboarding',
    linkFailureRedirect({ flow: 'code', error: missing, next: onboarding, marker: 'oauth' }),
    'exchange_failed',
  );
  is(
    'the sign-up form\'s flow=signup marker shows the notice',
    linkFailureRedirect({ flow: 'code', error: missing, marker: 'signup' }),
    'confirmed',
  );
  is(
    'and so does the sign-up form\'s own callback',
    linkFailureRedirect({ flow: 'code', error: missing, next: onboarding }),
    'confirmed',
  );
  is(
    'a signup token hash with no verifier is the same notice',
    linkFailureRedirect({ flow: 'token_hash', error: missing, type: 'signup', next: '/onboarding' }),
    'confirmed',
  );
  is(
    'the template\'s email type is too, when it points at onboarding',
    linkFailureRedirect({ flow: 'token_hash', error: missing, type: 'email', next: '/onboarding' }),
    'confirmed',
  );
  is(
    'an expired code is still the exchange error',
    linkFailureRedirect({ flow: 'code', error: expired, next: null }),
    'exchange_failed',
  );
  is(
    'an expired token hash is still the expired error',
    linkFailureRedirect({ flow: 'token_hash', error: expired, type: 'signup', next: '/onboarding' }),
    'link_expired',
  );
  is(
    'a magic link that cannot be verified is still expired',
    linkFailureRedirect({ flow: 'token_hash', error: missing, type: 'email', next: null }),
    'link_expired',
  );
  is(
    'a password reset keeps the exchange error',
    linkFailureRedirect({ flow: 'code', error: missing, type: 'recovery', next: '/sign-in/new-password' }),
    'exchange_failed',
  );
  is(
    'an OAuth return that names a page keeps the exchange error',
    linkFailureRedirect({ flow: 'code', error: missing, next: '/jobs/sales-a1b2' }),
    'exchange_failed',
  );
  is('a success is not a failure', linkFailureRedirect({ flow: 'code', error: null, next: null }), null);

  const callback = readFileSync(join(ROOT, 'src', 'app', 'auth', 'callback', 'route.ts'), 'utf8');
  is('the callback asks where a failed code goes', /linkFailureRedirect\(\{/.test(callback) && /flow: 'code'/.test(callback), true);
  is('and reads the flow marker', /marker: searchParams\.get\('flow'\)/.test(callback), true);
  is('and sends a confirmed address to sign-in', callback.includes('/sign-in?confirmed=1'), true);
  is('a real exchange failure still says so', callback.includes('/sign-in?error=exchange_failed'), true);

  const form = readFileSync(join(ROOT, 'src', 'components', 'auth', 'auth-form.tsx'), 'utf8');
  is('sign-up marks emailRedirectTo as a confirmation', /\/auth\/callback\?flow=signup&next=/.test(form), true);
  is('Google and Apple mark the callback as OAuth', /searchParams\.set\('flow', 'oauth'\)/.test(form), true);

  const post = readFileSync(join(ROOT, 'src', 'app', 'auth', 'confirm', 'route.ts'), 'utf8');
  is('confirm still verifies the token hash', /verifyOtp\(\{ type, token_hash: tokenHash \}\)/.test(post), true);
  is('and a signup token with no session asks the reader to sign in', /!data\.session && isSignupConfirmation\(type, next\)/.test(post), true);

  const signIn = readFileSync(join(ROOT, 'src', 'app', '[locale]', 'sign-in', 'page.tsx'), 'utf8');
  const notice = signIn.match(/<p\s+role="status"[\s\S]*?<\/p>/);
  is('the confirmed notice is a status, not an alert', Boolean(notice) && !/role="alert"/.test(notice[0]), true);
  is('in the specified green on a light green', Boolean(notice) && notice[0].includes('text-[#1A7F37]') && notice[0].includes('bg-[#F0FDF4]'), true);
  is('the failures stay an alert', /role="alert"/.test(signIn), true);
  is(
    'an error on the same URL wins over the confirmed notice',
    /confirmed === '1' && !error/.test(signIn) &&
      signIn.indexOf('linkFailed || sessionExpired') < signIn.indexOf('emailConfirmed ?'),
    true,
  );

  const ar = JSON.parse(readFileSync(join(ROOT, 'messages', 'ar.json'), 'utf8'));
  const en = JSON.parse(readFileSync(join(ROOT, 'messages', 'en.json'), 'utf8'));
  is('Arabic says the address is confirmed, in MSA', ar.auth.emailConfirmed, 'تم تأكيد بريدك الإلكتروني. سجّل الدخول للمتابعة.');
  is('English says to sign in', en.auth.emailConfirmed, 'Your email is confirmed. Sign in to continue.');

  // #1A7F37 on #F0FDF4. WCAG AA for normal text is 4.5:1.
  const channel = (hex, shift) => {
    const value = parseInt(hex.slice(1), 16) >> shift & 255;
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex) => 0.2126 * channel(hex, 16) + 0.7152 * channel(hex, 8) + 0.0722 * channel(hex, 0);
  const [hi, lo] = [luminance('#1A7F37'), luminance('#F0FDF4')].sort((a, b) => b - a);
  const ratio = (hi + 0.05) / (lo + 0.05);
  is('the green clears 4.5:1 on its background', ratio >= 4.5, true);
}

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
