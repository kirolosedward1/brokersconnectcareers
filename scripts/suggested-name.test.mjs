/**
 * Apple's name, and the private-relay address that is not one.
 *
 *   node --experimental-strip-types scripts/suggested-name.test.mjs
 *
 * Apple returns a name only on the first authorization, and Hide My Email's
 * local part is a random token. Onboarding asks for the name when neither is
 * a name. The Sign in with Apple control uses Apple's logo files and the
 * catalogue's exact Arabic label.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { suggestedDisplayName, isApplePrivateRelay } = await import('../src/lib/auth/suggested-name.ts');
const { appleProviderDisabled } = await import('../src/lib/auth/errors.ts');

const ROOT = join(import.meta.dirname, '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

let pass = 0;
let fail = 0;
function is(label, got, want) {
  const same = typeof want === 'function' ? want(got) : Object.is(got, want);
  if (same) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const relay = 'xq7k2m9p4t@privaterelay.appleid.com';

console.log('— name');
is('a shared name is kept', suggestedDisplayName({ metadata: { full_name: 'سارة عادل' }, email: relay, providers: ['apple'] }), 'سارة عادل');
is('name string when full_name is absent', suggestedDisplayName({ metadata: { name: 'Sara Adel' }, email: 'sara@icloud.com', providers: ['apple'] }), 'Sara Adel');
is(
  'Apple\'s first-and-last object',
  suggestedDisplayName({ metadata: { name: { firstName: 'سارة', lastName: 'عادل' } }, email: relay, providers: ['apple'] }),
  'سارة عادل',
);
is(
  'given and family names',
  suggestedDisplayName({ metadata: { given_name: 'Sara', family_name: 'Adel' }, email: relay, providers: ['apple'] }),
  'Sara Adel',
);
is('no name from Apple asks onboarding', suggestedDisplayName({ metadata: {}, email: 'sara@icloud.com', providers: ['apple'] }), '');
is('a blank name asks onboarding', suggestedDisplayName({ metadata: { full_name: '   ' }, email: relay, providers: ['apple'] }), '');
is('the relay token is not a name', suggestedDisplayName({ metadata: { full_name: 'xq7k2m9p4t' }, email: relay, providers: ['apple'] }), '');
is('a relay address with no name asks', suggestedDisplayName({ metadata: {}, email: relay, providers: ['email'] }), '');
is('an ordinary address still offers its local part', suggestedDisplayName({ metadata: {}, email: 'sara.adel@gmail.com', providers: ['email'] }), 'sara.adel');
is('relay host, any case', isApplePrivateRelay('A@PrivateRelay.AppleID.com'), true);
is('a shared iCloud address is not a relay', isApplePrivateRelay('sara@icloud.com'), false);

console.log('— provider switched off');
is('GoTrue\'s not-enabled message', appleProviderDisabled({ message: 'Unsupported provider: provider is not enabled' }), true);
is('a bad password is not that', appleProviderDisabled({ message: 'Invalid login credentials' }), false);

console.log('— button');
const ar = JSON.parse(read('messages/ar.json'));
const button = read('src/components/auth/apple-sign-in-button.tsx');
const form = read('src/components/auth/auth-form.tsx');
is('the Arabic label is Apple\'s', ar.auth.continueWithApple, 'تسجيل الدخول باستخدام Apple');
is('the form uses that label', form.includes("t('continueWithApple')"), true);
is('the button is not hidden until the provider is on', !/appleEnabled \? \(/.test(form), true);
is('a switched-off provider is said in the catalogue', form.includes("t('appleUnavailable')"), true);
is('the official white sheet', button.includes('/brand/apple-sign-in/left-white-logo-medium.svg'), true);
is('the official black sheet', button.includes('/brand/apple-sign-in/left-black-logo-medium.svg'), true);
is('same height and width as the other sign-in button', button.includes('size="lg"') && button.includes('w-full') && button.includes('h-12'), true);
is('black on light, white in the dark theme', button.includes('bg-[#000000]') && button.includes('dark:bg-[#ffffff]'), true);
is('the old redrawn mark is gone', !form.includes('M318.7') && !button.includes('M318.7'), true);
const onboarding = read('src/app/[locale]/onboarding/page.tsx');
is('a relay address is explained on the profile step', onboarding.includes('isApplePrivateRelay') && onboarding.includes('privateRelay='), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
