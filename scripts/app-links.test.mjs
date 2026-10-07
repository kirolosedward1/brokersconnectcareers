/**
 * Which links open the iOS app, and the page that answers its captcha.
 *
 *   node --experimental-strip-types scripts/app-links.test.mjs
 *
 * The apple-app-site-association file is read by iOS with a first-match rule,
 * so an include listed above an exclude would send the code-flow callback —
 * whose verifier lives in the browser — into the app, where it can only fail.
 * This builds the file and runs real paths through that rule. The captcha
 * page is checked off its source: it only talks to the WebView, only under a
 * configured site key, and only with the action names it knows.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { appSiteAssociation, parseAppIds, OPEN_IN_THE_APP } = await import('../src/lib/apple/app-site-association.ts');
const { assetLinks, parseFingerprints, ANDROID_PACKAGE } = await import('../src/lib/android/asset-links.ts');

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

console.log('— the app identifiers');
is('one', parseAppIds('ABCDE12345.net.brokersconnect.app'), ['ABCDE12345.net.brokersconnect.app']);
is('several, with spaces', parseAppIds('ABCDE12345.net.brokersconnect.app, ABCDE12345.net.brokersconnect.app.dev'), [
  'ABCDE12345.net.brokersconnect.app',
  'ABCDE12345.net.brokersconnect.app.dev',
]);
is('none set', parseAppIds(undefined), []);
is('a placeholder is not an app', parseAppIds('REPLACE_ME'), []);
is('a bundle id without its team is not an app', parseAppIds('net.brokersconnect.app'), []);

const file = appSiteAssociation(['ABCDE12345.net.brokersconnect.app']);
const components = file.applinks.details[0].components;

/** iOS's rule: the first component whose path pattern matches decides. */
function opensApp(path) {
  const pathname = new URL(path, 'https://www.brokersconnect.net').pathname;
  for (const component of components) {
    const pattern = new RegExp(`^${component['/'].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    if (pattern.test(pathname)) return !component.exclude;
  }
  return false;
}

console.log('\n— links that open the app');
for (const path of [
  '/jobs',
  '/jobs?track=primary&district=new-cairo',
  '/jobs/sales-consultant-a1b2',
  '/jobs/primary-sales-new-cairo',
  '/companies',
  '/companies/nile-brokers',
  '/notifications',
  '/dashboard/applications',
  '/employer/applicants',
  '/auth/confirm?token_hash=abc&type=email&redirect_to=https://www.brokersconnect.net/auth/callback',
]) {
  is(path, opensApp(path), true);
}

console.log('\n— links that stay on the web');
for (const path of [
  '/',
  '/auth/callback?code=abc',
  '/api/mobile/v1/jobs',
  '/api/cv/123',
  '/unsubscribe?token=abc',
  '/admin',
  '/admin/users',
  '/blog/how-commission-works',
  '/privacy',
  '/sign-in',
]) {
  is(path, opensApp(path), false);
}

console.log('\n— the file');
is('every exclude comes before every include', components.findIndex((c) => !c.exclude) > components.findLastIndex((c) => c.exclude), true);
is('passwords saved for the website are offered in the app', file.webcredentials.apps, ['ABCDE12345.net.brokersconnect.app']);

const route = readFileSync(join(ROOT, 'src', 'app', '.well-known', 'apple-app-site-association', 'route.ts'), 'utf8');
is('no app identifier, no file', /if \(!appIds\.length\) return new NextResponse\(null, \{ status: 404 \}\)/.test(route), true);
is('served as JSON', /NextResponse\.json\(/.test(route), true);

console.log('\n— Android: the site\'s claim for the app');
const release = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
is('a fingerprint, as eas credentials prints it', parseFingerprints(release), [release]);
is('lower case is read as the same fingerprint', parseFingerprints(release.toLowerCase()), [release]);
is('two, with spaces', parseFingerprints(`${release}, ${release.replace('AB:CD', '12:34')}`).length, 2);
is('none set', parseFingerprints(undefined), []);
is('a placeholder is not a fingerprint', parseFingerprints('REPLACE_ME'), []);
is('a SHA-1 is not the SHA-256 Android asks for', parseFingerprints('AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01'), []);
const links = assetLinks([release]);
is('it names the package and the certificate', links[0].target, {
  namespace: 'android_app',
  package_name: 'net.brokersconnect.app',
  sha256_cert_fingerprints: [release],
});
is('links open the app, and saved passwords are offered', links[0].relation, [
  'delegate_permission/common.handle_all_urls',
  'delegate_permission/common.get_login_creds',
]);
const androidRoute = readFileSync(join(ROOT, 'src', 'app', '.well-known', 'assetlinks.json', 'route.ts'), 'utf8');
is('no fingerprint, no file', /if \(!fingerprints\.length\) return new NextResponse\(null, \{ status: 404 \}\)/.test(androidRoute), true);
is('served as JSON', /NextResponse\.json\(/.test(androidRoute), true);

console.log('\n— Android: the app\'s side');
const appConfig = readFileSync(join(ROOT, 'mobile', 'app.config.ts'), 'utf8');
const androidPaths = JSON.parse(
  appConfig
    .match(/const APP_LINK_PATHS = (\[[^\]]*\])/)[1]
    .replace(/'/g, '"')
    .replace(/,(\s*\])/, '$1'),
);
// iOS's '/auth/confirm*' is that one page, with whatever query it carries; Android matches the path alone.
const iosPaths = OPEN_IN_THE_APP.map((path) => path.replace(/([^/])\*$/, '$1'));
is('the app opens the pages the iOS file names', [...androidPaths].sort(), [...iosPaths].sort());
is('a section never stands for whatever begins the same (/employers is the website\'s)', androidPaths.every((path) => !path.endsWith('*') || path.endsWith('/*')), true);
is('it is the package the site names', appConfig.includes(`package: '${ANDROID_PACKAGE}'`), true);
is('Android is asked to verify them', /autoVerify: true/.test(appConfig), true);

console.log('\n— the captcha page');
const captcha = readFileSync(join(ROOT, 'src', 'app', 'api', 'mobile', 'v1', 'captcha', 'route.ts'), 'utf8');
is('without a site key it is not there', /if \(!siteKey\)[\s\S]{0,120}status: 404/.test(captcha), true);
is('it speaks only to the WebView', /window\.ReactNativeWebView\.postMessage/.test(captcha) && !/window\.parent|window\.opener|location\.href\s*=/.test(captcha), true);
is('it asks for the sheet only when Cloudflare wants a person', /'before-interactive-callback'[\s\S]{0,80}type: 'interactive'/.test(captcha), true);
is('it runs invisibly, as on the website', /appearance: 'interaction-only'/.test(captcha), true);
is('an unknown action falls back to a known one', /ACTIONS\.has\(params\.get\('action'\)/.test(captcha), true);
is('it is never cached or indexed', /'cache-control': 'no-store'/.test(captcha) && /noindex/.test(captcha), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
