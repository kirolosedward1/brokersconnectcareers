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
const { qrSvg } = await import('../src/lib/app-qr.ts');

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

console.log('\n— the QR');
const svg = await qrSvg('https://www.brokersconnect.net/api/app/open');
is('an svg', typeof svg === 'string' && svg.startsWith('<svg') && !svg.includes('<script'), true);

console.log('\n— the card');
const promo = read('src/components/jobs/app-promo.tsx');
const column = read('src/components/jobs/results-column.tsx');
const board = read('src/components/jobs/jobs-board.tsx');
const marks = read('src/components/get-app/store-marks.tsx');
const chrome = read('src/app/api/chrome/route.ts');
const route = read('src/app/api/app/open/route.ts');
const tint = read('src/app/globals.css');
const ar = JSON.parse(read('messages/ar.json'));
const en = JSON.parse(read('messages/en.json'));

is('inline after the 5th result', APP_PROMO_INLINE_AFTER, 5);
is('the board uses that count', board.includes('APP_PROMO_INLINE_AFTER - 1') && board.includes('lg:hidden'), true);
is('the side column is 300px, on the left in RTL, and sticks 96px down', column.includes('lg:grid-cols-[minmax(0,1fr)_300px]') && column.includes('top-[96px]') && column.includes('w-[300px]') && column.includes('hidden w-[300px]'), true);
is('from the lg breakpoint, which is 1024px', column.includes('lg:block') && column.includes('lg:grid'), true);
is('the QR is desktop only, and only once a listing is set', promo.includes("variant === 'rail' && listed") && promo.includes('APP_SMART_LINK_PATH'), true);
is('no greyed badge', !promo.includes('aria-disabled') && !promo.includes('grayscale'), true);
is('badges are the 40px black ones, 8px apart', marks.includes('h-10') && marks.includes('bg-black') && promo.includes('gap-2'), true);
const tintRule = tint.slice(tint.indexOf('.bg-brand-tint'), tint.indexOf('}', tint.indexOf('.bg-brand-tint')) + 1);
is('flat tint, 16px radius, 24px padding, no shadow', promo.includes('rounded-[16px]') && promo.includes('bg-brand-tint') && promo.includes('p-6') && promo.includes('shadow-none') && tintRule.startsWith('.bg-brand-tint') && !tintRule.includes('gradient'), true);
is('the QR is 120px on a white tile', promo.includes('size-[120px]') && promo.includes('bg-white') && promo.includes('border'), true);
is('the smart link is the QR route, and it is not cached', APP_SMART_LINK_PATH, '/api/app/open');
is('the route redirects from the user-agent and does not cache it', route.includes('storeRedirectTarget') && route.includes("headers.get('user-agent')") && route.includes('no-store'), true);
is('a registered phone hides the card', chrome.includes("from('push_devices')") && chrome.includes(".is('disabled_at', null)") && chrome.includes('hasApp') && column.includes('session.hasApp'), true);

is('Arabic title', ar.jobs.appPromo.title, 'إشعارات فورية بالوظائف الجديدة');
is('Arabic line', ar.jobs.appPromo.body, 'تابع طلباتك ورسائل الشركات من تطبيق بروكرز كونكت.');
is('Arabic coming soon', ar.jobs.appPromo.comingSoon, 'التطبيق قريبًا على iOS وAndroid');
is('Arabic caption', ar.jobs.appPromo.qrCaption, 'امسح الرمز لتحميل التطبيق');
is('tanween sits on the letter before the alef', ar.jobs.appPromo.comingSoon.includes('اً'), false);
is('English is the same four lines', Object.keys(en.jobs.appPromo), Object.keys(ar.jobs.appPromo));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
