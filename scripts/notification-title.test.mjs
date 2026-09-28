/**
 * The sentence a notification reads as, in both languages.
 *
 *   node --experimental-strip-types scripts/notification-title.test.mjs
 *
 * notificationTitle() is shared by the web bell, the mobile app's feed and the
 * push a phone receives, so what is pinned here is what all three say: every
 * kind has words in Arabic and English, the kinds that carry a second fact say
 * it, and a kind this build has never heard of reads as the generic notice
 * instead of a raw key.
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { createTranslator } = await import('next-intl');
const { notificationTitle, isKnownNotificationKind } = await import('../src/lib/notifications/title.ts');

const messages = {
  ar: JSON.parse(readFileSync(new URL('../messages/ar.json', import.meta.url), 'utf8')),
  en: JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8')),
};

let pass = 0;
let fail = 0;

function ok(label, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A translator that reports a missing key instead of printing it. */
function translator(locale) {
  const missing = [];
  const t = createTranslator({
    locale,
    messages: messages[locale],
    onError: (error) => missing.push(error.message),
    getMessageFallback: ({ key, namespace }) => `MISSING:${namespace ? `${namespace}.` : ''}${key}`,
  });
  return { t: (key, values) => t(key, values), missing };
}

const KINDS = [
  'application_submitted',
  'application_received',
  'application_withdrawn',
  'application_moved',
  'job_published',
  'job_rejected',
  'company_verified',
  'account_approved',
  'account_rejected',
  'job_expiring',
  'job_expired',
  'company_verification_needed',
  'profile_visibility_changed',
  'password_changed',
  'support_replied',
  // Moderation (migration 325).
  'report_reviewed',
  'company_suspended',
  'company_restored',
  'profile_restricted',
  'profile_restored',
  'account_held',
  'appeal_decided',
];

const payload = {
  title_ar: 'مستشار مبيعات عقارية',
  title_en: 'Property sales consultant',
  name_ar: 'شركة النيل',
  name_en: 'Nile Co',
  status: 'shortlisted',
  visibility: 'public',
  count: 1,
};

for (const locale of ['ar', 'en']) {
  console.log(`\n— every kind has words in ${locale}`);
  for (const kind of KINDS) {
    const { t, missing } = translator(locale);
    const title = notificationTitle({ kind, payload }, locale, t);
    ok(
      `${kind}`,
      title.length > 0 && !title.includes('MISSING:') && missing.length === 0,
      `got ${JSON.stringify(title)} ${missing.join('; ')}`,
    );
  }
}

console.log('\n— the subject is the listing, in the reader\'s language, falling back to Arabic');
{
  const { t } = translator('en');
  const title = notificationTitle({ kind: 'job_published', payload }, 'en', t);
  ok('English reads the English title', title.includes('Property sales consultant'), title);
  const noEnglish = notificationTitle({ kind: 'job_published', payload: { title_ar: 'وظيفة' } }, 'en', t);
  ok('a missing English title falls back to the Arabic one', noEnglish.includes('وظيفة'), noEnglish);
}

console.log('\n— the three kinds that say a second fact say it');
{
  const { t } = translator('en');
  const moved = notificationTitle({ kind: 'application_moved', payload }, 'en', t);
  const statusWord = messages.en.applicationStatus.shortlisted;
  ok('a move names the new stage', moved.includes(statusWord), moved);

  const many = notificationTitle(
    { kind: 'application_received', payload: { ...payload, count: 5 } },
    'en',
    t,
  );
  const one = notificationTitle({ kind: 'application_received', payload }, 'en', t);
  ok('several applicants read differently from one', many !== one && many.includes('5'), many);

  const visibility = notificationTitle({ kind: 'profile_visibility_changed', payload }, 'en', t);
  ok('a visibility change names the new setting', visibility.includes(messages.en.visibility.public), visibility);
}

console.log('\n— a decision says which way it went, never what was done');
for (const locale of ['ar', 'en']) {
  const { t, missing } = translator(locale);
  const say = (kind, outcome) => notificationTitle({ kind, payload: { ...payload, outcome } }, locale, t);
  const notifications = messages[locale].notifications;
  ok(
    `${locale}: a report that led to action, and one that did not`,
    say('report_reviewed', 'actioned') !== say('report_reviewed', 'reviewed') &&
      say('report_reviewed', 'actioned').includes(payload[`title_${locale}`]) &&
      missing.length === 0,
  );
  ok(
    `${locale}: an appeal overturned, and one upheld`,
    say('appeal_decided', 'overturned') !== say('appeal_decided', 'upheld') &&
      !say('appeal_decided', 'upheld').includes('MISSING:') &&
      notifications.appealUpheld.length > 0,
  );
}

console.log('\n— a kind this build does not know reads as the generic notice');
for (const locale of ['ar', 'en']) {
  const { t, missing } = translator(locale);
  const title = notificationTitle({ kind: 'something_added_later', payload: {} }, locale, t);
  ok(
    `${locale}: generic, not a raw key`,
    title === messages[locale].notifications.generic && missing.length === 0,
    JSON.stringify(title),
  );
}
ok('isKnownNotificationKind agrees', isKnownNotificationKind('job_published') && !isKnownNotificationKind('nope'));
ok('it is not fooled by an inherited property', !isKnownNotificationKind('toString'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
