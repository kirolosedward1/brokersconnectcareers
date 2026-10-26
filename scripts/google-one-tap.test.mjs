/**
 * Where Google One Tap may appear, and the nonce GIS and Supabase each get.
 *
 *   node --experimental-strip-types scripts/google-one-tap.test.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const {
  ONE_TAP_CLOSED_KEY,
  createNonce,
  clientIdForOneTap,
  googleInitializeOptions,
  googleOneTapNonce,
  gsiScriptSrc,
  hashNonce,
  isGoogleWebClientId,
  isOneTapPage,
  oneTapClosedByVisitor,
  oneTapClosedThisSession,
  rememberOneTapClosed,
  shouldShowGoogleOneTap,
} = await import('../src/lib/auth/google-one-tap.ts');
const { hidesAppPromo, isAppWebView, isInApp } = await import('../src/lib/app-view.ts');

let pass = 0;
let fail = 0;
function is(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

const CLIENT = '123456789012-abcXYZ_12.apps.googleusercontent.com';

console.log('— which pages');
for (const path of ['/', '/jobs', '/jobs/senior-broker', '/en', '/en/jobs', '/en/jobs/senior-broker', '/ar', '/ar/jobs', '/jobs/', '/jobs/توظيف-القاهرة']) {
  is(`${path || '/'} is an One Tap page`, isOneTapPage(path), true);
}
for (const path of [
  '/sign-in',
  '/sign-in/candidate',
  '/sign-in/employer',
  '/sign-in/forgot',
  '/sign-up',
  '/sign-up/candidate',
  '/sign-up/employer',
  '/en/sign-in',
  '/jobs/senior-broker/apply',
  '/companies',
  '/companies/acme',
  '/employers',
  '/blog',
  '/support',
  '/privacy',
  '/onboarding',
  '/dashboard',
  '/employer/jobs',
]) {
  is(`${path} is not an One Tap page`, isOneTapPage(path), false);
}

console.log('— the app WebView');
const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const wk = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const androidWv = 'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36';
const chrome = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
is('the ReactNativeWebView flag, whatever the UA', isAppWebView({ userAgent: safari, reactNativeWebView: true }), true);
is('Android WebView token ; wv)', isAppWebView({ userAgent: androidWv }), true);
is('iOS WKWebView without Safari/', isAppWebView({ userAgent: wk }), true);
is('Mobile Safari is the browser', isAppWebView({ userAgent: safari }), false);
is('Chrome Custom Tab has no ; wv)', isAppWebView({ userAgent: chrome }), false);
is('a desktop browser', isAppWebView({ userAgent: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36' }), false);

console.log('— whether to show it');
const open = {
  pathname: '/jobs/senior-broker',
  signedIn: false,
  sessionPending: false,
  dismissedThisSession: false,
  webView: false,
  googleEnabled: true,
  clientId: CLIENT,
};
is('a signed-out visitor on a job', shouldShowGoogleOneTap(open), true);
is('home', shouldShowGoogleOneTap({ ...open, pathname: '/' }), true);
is('the jobs list', shouldShowGoogleOneTap({ ...open, pathname: '/jobs' }), true);
is('signed in', shouldShowGoogleOneTap({ ...open, signedIn: true }), false);
is('session still loading', shouldShowGoogleOneTap({ ...open, sessionPending: true }), false);
is('closed earlier this tab', shouldShowGoogleOneTap({ ...open, dismissedThisSession: true }), false);
is('inside the app WebView', shouldShowGoogleOneTap({ ...open, webView: true }), false);
is('a WebView user agent', shouldShowGoogleOneTap({ ...open, userAgent: androidWv }), false);
is('the ReactNativeWebView flag on the prompt', shouldShowGoogleOneTap({ ...open, reactNativeWebView: true, userAgent: safari }), false);
is('?app=1 hides One Tap', shouldShowGoogleOneTap({ ...open, search: '?app=1' }), false);
is('the flag among other parameters', shouldShowGoogleOneTap({ ...open, search: '?q=cairo&app=1' }), false);
is('app=10 is not the flag', shouldShowGoogleOneTap({ ...open, search: '?app=10' }), true);
is('App=1 is not the flag', shouldShowGoogleOneTap({ ...open, search: '?App=1' }), true);
is('the bc_app cookie hides One Tap', shouldShowGoogleOneTap({ ...open, cookie: 'bc_app=1' }), false);
is('the cookie beside another', shouldShowGoogleOneTap({ ...open, cookie: 'theme=light; bc_app=1' }), false);
is('bc_app=12 is not the cookie', shouldShowGoogleOneTap({ ...open, cookie: 'bc_app=12' }), true);
is('a name that only contains bc_app', shouldShowGoogleOneTap({ ...open, cookie: 'not_bc_app=1' }), true);
is('Mobile Safari with no marker still shows it', shouldShowGoogleOneTap({ ...open, userAgent: safari, search: '', cookie: '' }), true);

console.log('— the app marker');
is('no query and no cookie', hidesAppPromo({ search: '', cookie: '' }), false);
is('?app=1', hidesAppPromo({ search: '?app=1' }), true);
is('app=1 without a leading ?', hidesAppPromo({ search: 'app=1' }), true);
is('the cookie alone', hidesAppPromo({ cookie: 'bc_app=1' }), true);
is('either signal is the app', isInApp({ search: '?app=1', userAgent: safari }), true);
is('the WebView without the marker is the app', isInApp({ userAgent: wk, search: '', cookie: '' }), true);
is('a browser visit is not the app', isInApp({ userAgent: safari, search: '', cookie: '' }), false);
is('Google disabled at GoTrue', shouldShowGoogleOneTap({ ...open, googleEnabled: false }), false);
is('no client id', shouldShowGoogleOneTap({ ...open, clientId: undefined }), false);
is('the e2e stand-in is not a web client id', shouldShowGoogleOneTap({ ...open, clientId: 'e2e' }), false);
is('a placeholder is not a web client id', isGoogleWebClientId('REPLACE_ME_google'), false);

console.log('— the client id reaches the browser as a prop');
is('a web client id is the prop', clientIdForOneTap(CLIENT), CLIENT);
is('unset is not passed', clientIdForOneTap(undefined), undefined);
is('empty is not passed', clientIdForOneTap(''), undefined);
is('a placeholder is not passed', clientIdForOneTap('REPLACE_ME_google'), undefined);
is('the e2e stand-in is not passed', clientIdForOneTap('e2e'), undefined);
const layout = readFileSync(new URL('../src/app/[locale]/(site)/layout.tsx', import.meta.url), 'utf8');
const prompt = readFileSync(new URL('../src/components/auth/google-one-tap.tsx', import.meta.url), 'utf8');
is('the site layout is a server component', layout.includes("'use client'") || layout.includes('"use client"'), false);
is(
  'the server reads SUPABASE_AUTH_GOOGLE_CLIENT_ID',
  layout.includes('clientIdForOneTap(process.env.SUPABASE_AUTH_GOOGLE_CLIENT_ID)'),
  true,
);
is('that read is not a NEXT_PUBLIC_ variable', layout.includes('NEXT_PUBLIC_SUPABASE_AUTH_GOOGLE_CLIENT_ID'), false);
is('the server passes it as the clientId prop', layout.includes('<GoogleOneTap clientId={googleClientId}'), true);
is('One Tap is a client component', prompt.startsWith("'use client'"), true);
is('the prompt takes clientId and does not read the env', prompt.includes('{ clientId, locale }') && !prompt.includes('process.env') && !prompt.includes('SUPABASE_AUTH_GOOGLE_CLIENT_ID'), true);
is('GIS is initialized with that prop', prompt.includes('googleInitializeOptions({\n              clientId,'), true);
is(
  'the prompt reads the app marker and the WebView',
  prompt.includes('window.location.search') &&
    prompt.includes('document.cookie') &&
    prompt.includes('navigator.userAgent') &&
    prompt.includes('ReactNativeWebView') &&
    !prompt.includes('document.cookie ='),
  true,
);
is('the sign-in page', shouldShowGoogleOneTap({ ...open, pathname: '/sign-in' }), false);
is('sign-up', shouldShowGoogleOneTap({ ...open, pathname: '/sign-up/candidate' }), false);
is('the apply form', shouldShowGoogleOneTap({ ...open, pathname: '/jobs/senior-broker/apply' }), false);

console.log('— nonce');
const known = await hashNonce('abc');
is('SHA-256 hex of the raw nonce', known, createHash('sha256').update('abc').digest('hex'));
is('the hash is not the raw value', known === 'abc', false);
const minted = createNonce();
is('a nonce is 32 bytes of hex', /^[0-9a-f]{64}$/.test(minted), true);
const pair = await googleOneTapNonce();
is('Supabase gets the raw nonce', pair.supabaseNonce !== pair.googleNonce && /^[0-9a-f]{64}$/.test(pair.supabaseNonce), true);
is('Google gets the SHA-256 of that nonce', pair.googleNonce, await hashNonce(pair.supabaseNonce));
const options = googleInitializeOptions({
  clientId: CLIENT,
  googleNonce: pair.googleNonce,
  callback: () => {},
});
is('FedCM where the browser supports it', options.use_fedcm_for_prompt, true);
is('the hashed nonce is what GIS is given', options.nonce, pair.googleNonce);
is('no auto-select and no cooldown override', ['auto_select', 'cancel_on_tap_outside', 'prompt_parent_id'].every((key) => !(key in options)), true);

console.log('— locale');
is('Arabic locale, including / and /ar', gsiScriptSrc('ar'), 'https://accounts.google.com/gsi/client?hl=ar');
is('English locale', gsiScriptSrc('en'), 'https://accounts.google.com/gsi/client?hl=en');

console.log('— a close, this session only');
is('a skip the visitor made', oneTapClosedByVisitor({ isSkippedMoment: () => true, getSkippedReason: () => 'user_cancel' }), true);
is('a tap outside', oneTapClosedByVisitor({ isSkippedMoment: () => true, getSkippedReason: () => 'tap_outside' }), true);
is('our own cancel on navigation', oneTapClosedByVisitor({ isDismissedMoment: () => true, getDismissedReason: () => 'cancel_called' }), false);
is('a credential coming back', oneTapClosedByVisitor({ isDismissedMoment: () => true, getDismissedReason: () => 'credential_returned' }), false);
is('FedCM close, no legacy reason', oneTapClosedByVisitor({ isDismissedMoment: () => true, getDismissedReason: () => '' }), true);
is('not displayed is Google’s cooldown, not our flag', oneTapClosedByVisitor({ isNotDisplayed: () => true }), false);

const store = new Map();
globalThis.sessionStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, value),
};
is('nothing remembered yet', oneTapClosedThisSession(), false);
rememberOneTapClosed();
is('the cookie-page key is what was written', store.get(ONE_TAP_CLOSED_KEY), '1');
is('the same tab now counts as closed', oneTapClosedThisSession(), true);

console.log('— CSP, the hosts Google documents and nothing broader');
const config = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8');
is('script-src names the GIS client', config.includes('https://accounts.google.com/gsi/client'), true);
is('frame and connect name the GIS parent', config.includes('https://accounts.google.com/gsi/'), true);
is('style-src names the GIS stylesheet', config.includes('https://accounts.google.com/gsi/style'), true);
for (const broader of ['https://apis.google.com', 'fonts.gstatic.com', 'https://www.google.com', '*.google.com', 'https://accounts.google.com/gsi/status']) {
  is(`CSP does not add ${broader}`, config.includes(broader), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
