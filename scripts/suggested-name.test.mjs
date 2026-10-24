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
const en = JSON.parse(read('messages/en.json'));
const button = read('src/components/auth/apple-sign-in-button.tsx');
const form = read('src/components/auth/auth-form.tsx');
is('the Arabic label is Apple\'s', ar.auth.signInWithApple, 'تسجيل الدخول باستخدام Apple');
is('the English label matches', en.auth.signInWithApple, 'Sign in with Apple');
is('the form uses that label', form.includes("t('signInWithApple')"), true);
is('the old continueWithApple key is gone', ar.auth.continueWithApple, undefined);
is('the old continueWithGoogle key is gone', ar.auth.continueWithGoogle ?? en.auth.continueWithGoogle, undefined);
is('sign-up says التسجيل باستخدام Apple', ar.auth.signUpWithApple, 'التسجيل باستخدام Apple');
is('sign-in says تسجيل الدخول باستخدام Google', ar.auth.signInWithGoogle, 'تسجيل الدخول باستخدام Google');
is('sign-up says التسجيل باستخدام Google', ar.auth.signUpWithGoogle, 'التسجيل باستخدام Google');
is('the form picks the label for the page', form.includes("t('signUpWithApple')") && form.includes("t('signInWithGoogle')") && form.includes("t('signUpWithGoogle')"), true);
is(
  'the line under the button, in MSA',
  ar.auth.appleSameEmail,
  'لديك حساب بالفعل؟ سجّل الدخول بالبريد الإلكتروني نفسه أولًا.',
);
is(
  'and in English',
  en.auth.appleSameEmail,
  'Already have an account? Sign in with the same email first.',
);
is('the form shows that line', form.includes("t('appleSameEmail')"), true);
is('the Apple button is hidden while the provider is off', /\{appleEnabled \? \(/.test(form), true);
is('the divider stays when any provider is on', form.includes('appleEnabled || googleEnabled'), true);
is('a switched-off provider is said in the catalogue', form.includes("t('appleUnavailable')"), true);
is('the official white sheet', button.includes('/brand/apple-sign-in/left-white-logo-medium.svg'), true);
is('the official black sheet', button.includes('/brand/apple-sign-in/left-black-logo-medium.svg'), true);
is(
  'same height and width as the other sign-in button',
  button.includes('size="lg"') &&
    button.includes('w-full') &&
    button.includes('max-w-full') &&
    button.includes('min-w-0') &&
    button.includes('px-3') &&
    button.includes('min-[360px]:px-6') &&
    button.includes('h-12'),
  true,
);
is(
  'the Google button is held to the same width',
  form.includes('w-full max-w-full min-w-0 whitespace-nowrap px-3 min-[360px]:px-6'),
  true,
);
is('the Apple label can shrink', button.includes('className="min-w-0 whitespace-nowrap"'), true);
const noteAt = form.indexOf("t('appleSameEmail')");
const googleAt = form.indexOf("t('signInWithGoogle')");
const dividerAt = form.indexOf("{t('or')}");
is(
  'the linking note is 13px, grey, and balanced inside the column',
  form.includes('w-full max-w-full min-w-0 text-balance text-center text-[13px] leading-[18px] text-muted-foreground'),
  true,
);
is('the note sits under both provider buttons', noteAt > googleAt && noteAt > form.indexOf("t('signInWithApple')"), true);
is('and above the divider', noteAt < dividerAt, true);
is('the note is not taken out of the column', !form.includes('whitespace-nowrap text-[13px]') && !form.includes('-translate-x-1/2'), true);
is('black on light, white in the dark theme', button.includes('bg-[#000000]') && button.includes('dark:bg-[#ffffff]'), true);
is('the old redrawn mark is gone', !form.includes('M318.7') && !button.includes('M318.7'), true);
const onboarding = read('src/app/[locale]/onboarding/page.tsx');
is('a relay address is explained on the profile step', onboarding.includes('isApplePrivateRelay') && onboarding.includes('privateRelay='), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
