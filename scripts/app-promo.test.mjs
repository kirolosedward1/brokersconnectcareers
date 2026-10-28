/**
 * The results-page app card: where it sits, what it says while the app
 * is unlisted, and which store a phone is sent to once a listing exists.
 *
 *   node --experimental-strip-types scripts/app-promo.test.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const {
  APP_PROMO_INLINE_AFTER,
  APP_SMART_LINK_PATH,
  phonePlatform,
  resolvedStoreUrls,
  storeRedirectTarget,
} = await import('../src/lib/app-links.ts');
const {
  appViewCookieAssignment,
  hidesAppPromo,
  persistAppView,
} = await import('../src/lib/app-view.ts');

const ROOT = join(import.meta.dirname, '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

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

const APP = 'https://apps.apple.com/app/brokers-connect/id123';
const PLAY = 'https://play.google.com/store/apps/details?id=net.brokersconnect.app';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

console.log('— which phone');
is('iPhone', phonePlatform(IPHONE), 'ios');
is('iPad', phonePlatform(IPAD), 'ios');
is('Android', phonePlatform(ANDROID), 'android');
is('a Mac', phonePlatform(MAC), 'other');
is('iPadOS pretending to be a Mac, when it still says Mobile', phonePlatform(`${MAC} Mobile/15E148`), 'ios');

console.log('\n— a listing is only the store\'s own https address');
is('empty', resolvedStoreUrls({ appStore: null, play: '' }), { appStore: null, play: null });
is('the two stores', resolvedStoreUrls({ appStore: APP, play: PLAY }), { appStore: APP, play: PLAY });
is('http is not a listing', resolvedStoreUrls({ appStore: 'http://apps.apple.com/app/id1' }).appStore, null);
is('another host is not a listing', resolvedStoreUrls({ play: 'https://example.com/store' }).play, null);

console.log('\n— the smart link');
const both = { appStore: APP, play: PLAY };
is('an iPhone with both listings', storeRedirectTarget(IPHONE, both), APP);
is('an Android phone with both listings', storeRedirectTarget(ANDROID, both), PLAY);
is('a laptop with both listings goes to the page that has both buttons', storeRedirectTarget(MAC, both), '/app');
is('an iPhone, App Store only', storeRedirectTarget(IPHONE, { appStore: APP, play: null }), APP);
is('an Android phone, Play only', storeRedirectTarget(ANDROID, { appStore: null, play: PLAY }), PLAY);
is('an Android phone is not sent to the App Store', storeRedirectTarget(ANDROID, { appStore: APP, play: null }), '/app');
is('an iPhone is not sent to Google Play', storeRedirectTarget(IPHONE, { appStore: null, play: PLAY }), '/app');
is('a laptop with one listing', storeRedirectTarget(MAC, { appStore: APP, play: null }), APP);
is('nothing listed', storeRedirectTarget(IPHONE, { appStore: null, play: null }), '/app');

console.log('\n— ?app=1 and the session cookie');
is('no query and no cookie shows the card', hidesAppPromo({ search: '', cookie: '' }), false);
is('?app=1 hides it', hidesAppPromo({ search: '?app=1' }), true);
is('the flag among other filters', hidesAppPromo({ search: '?q=cairo&app=1' }), true);
is('app=10 is not the flag', hidesAppPromo({ search: '?app=10' }), false);
is('a different parameter is not the flag', hidesAppPromo({ search: '?application=1' }), false);
is('the cookie alone hides it', hidesAppPromo({ cookie: 'bc_app=1' }), true);
is('the cookie beside another', hidesAppPromo({ cookie: 'theme=light; bc_app=1' }), true);
is('a longer value is not the cookie', hidesAppPromo({ cookie: 'bc_app=12' }), false);
is('a name that only contains the cookie name', hidesAppPromo({ cookie: 'not_bc_app=1' }), false);
is('the decision is the query and the cookie only', hidesAppPromo({ search: '?in_app=1', cookie: '' }), false);
let written = null;
is('https writes a Secure session cookie', persistAppView({ search: '?app=1', protocol: 'https:' }, (value) => { written = value; }), true);
is('the assignment has no expiry', written, 'bc_app=1; Path=/; SameSite=Lax; Secure');
is('http omits Secure', appViewCookieAssignment(false), 'bc_app=1; Path=/; SameSite=Lax');
is('a page without the flag writes nothing', persistAppView({ search: '', protocol: 'https:' }, () => { written = 'no'; }), false);

console.log('\n— the card');
const promo = read('src/components/jobs/app-promo.tsx');
const column = read('src/components/jobs/results-column.tsx');
const board = read('src/components/jobs/jobs-board.tsx');
const marks = read('src/components/get-app/store-marks.tsx');
const chrome = read('src/app/api/chrome/route.ts');
const route = read('src/app/api/app/open/route.ts');
const view = read('src/lib/app-view.ts');
const marker = read('src/components/app-view-cookie.tsx');
const layout = read('src/app/[locale]/layout.tsx');
const pkg = JSON.parse(read('package.json'));
const tint = read('src/app/globals.css');
const ar = JSON.parse(read('messages/ar.json'));
const en = JSON.parse(read('messages/en.json'));

is('inline after the 5th result', APP_PROMO_INLINE_AFTER, 5);
is('the board uses that count', board.includes('APP_PROMO_INLINE_AFTER - 1') && board.includes('lg:hidden'), true);
is('the side column is 300px, on the left in RTL, and sticks 96px down', column.includes('lg:grid-cols-[minmax(0,1fr)_300px]') && column.includes('top-[96px]') && column.includes('w-[300px]') && column.includes('hidden w-[300px]'), true);
is('from the lg breakpoint, which is 1024px', column.includes('lg:block') && column.includes('lg:grid'), true);
is('no QR is drawn, and qrcode is not a dependency', !promo.includes('app-qr') && !promo.includes('qrcode') && !promo.includes('size-[120px]') && !promo.includes('dangerouslySetInnerHTML') && !pkg.dependencies.qrcode && !pkg.devDependencies['@types/qrcode'], true);
is('no greyed badge', !promo.includes('aria-disabled') && !promo.includes('grayscale'), true);
is('badges are the 40px black ones, 8px apart', marks.includes('h-10') && marks.includes('bg-black') && promo.includes('gap-2'), true);
const tintRule = tint.slice(tint.indexOf('.bg-brand-tint'), tint.indexOf('}', tint.indexOf('.bg-brand-tint')) + 1);
is('flat tint, 16px radius, 24px padding, no shadow', promo.includes('rounded-[16px]') && promo.includes('bg-brand-tint') && promo.includes('p-6') && promo.includes('shadow-none') && tintRule.startsWith('.bg-brand-tint') && !tintRule.includes('gradient'), true);
is('the smart link stays, for when a QR is added', APP_SMART_LINK_PATH, '/api/app/open');
is('the route redirects from the user-agent and does not cache it', route.includes('storeRedirectTarget') && route.includes("headers.get('user-agent')") && route.includes('no-store'), true);
is('a registered phone hides the card', chrome.includes("from('push_devices')") && chrome.includes(".is('disabled_at', null)") && chrome.includes('hasApp') && column.includes('session.hasApp'), true);
is('?app=1 is remembered from any page and hides both cards', column.includes('hidesAppPromo') && column.includes('bc-app-view') && marker.includes('writeAppViewCookie') && layout.includes('AppViewCookie') && view.includes("APP_VIEW_COOKIE = 'bc_app'"), true);

is('Arabic title', ar.jobs.appPromo.title, 'إشعارات فورية بالوظائف الجديدة');
is('Arabic line', ar.jobs.appPromo.body, 'تابع طلباتك ورسائل الشركات من تطبيق بروكرز كونكت.');
is('Arabic coming soon', ar.jobs.appPromo.comingSoon, 'التطبيق قريبًا على <bdi>iOS</bdi> و<bdi>Android</bdi>');
is('each store name is its own bdi', promo.includes("t.rich('comingSoon'") && promo.includes('<bdi>'), true);
is('the tint is the brand blue at 7% on white', tintRule.includes('7%') && tintRule.includes('brand-blue') && tintRule.includes('white'), true);
is('tanween sits on the letter before the alef', ar.jobs.appPromo.comingSoon.includes('اً'), false);
is('English is the same lines', Object.keys(en.jobs.appPromo), Object.keys(ar.jobs.appPromo));
is('no caption while there is no QR', ar.jobs.appPromo.qrCaption, undefined);
is(
  'the rail frames the real jobs capture and does not link a store',
  promo.includes('/app-screenshots/jobs.webp') &&
    promo.includes('PhoneFrame') &&
    promo.includes('screenshotAlt') &&
    promo.includes('overflow-hidden') &&
    !promo.includes('apps.apple.com') &&
    !promo.includes('play.google.com'),
  true,
);
is('Arabic screenshot label', ar.jobs.appPromo.screenshotAlt, 'قائمة الوظائف في تطبيق بروكرز كونكت');
is('English screenshot label', en.jobs.appPromo.screenshotAlt, 'The jobs list in the Brokers Connect app');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
