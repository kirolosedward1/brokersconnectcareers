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

const { appSiteAssociation, parseAppIds } = await import('../src/lib/apple/app-site-association.ts');

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
