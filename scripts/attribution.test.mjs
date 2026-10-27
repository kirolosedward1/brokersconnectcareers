/**
 * The first visit: one name for a referrer, and an older account stays unknown.
 *
 *   node --experimental-strip-types scripts/attribution.test.mjs
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { classifyTouch, hostOf, landingPathOf } = await import('../src/lib/attribution.ts');
const { parseTouch, serialiseTouch, touchFromCookieHeader } = await import('../src/lib/attribution-cookie.ts');
const { writeFirstTouch } = await import('../src/lib/attribution-write.ts');

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

const own = ['brokersconnect.net', 'localhost'];

console.log('— a host names the source, and our own site does not');
is('instagram link shim', classifyTouch({ referrer: 'https://l.instagram.com/x' }, own).source, 'instagram');
is('facebook link shim', classifyTouch({ referrer: 'https://lm.facebook.com/l.php' }, own).source, 'facebook');
is('mail before the search engine that hosts it', classifyTouch({ referrer: 'https://mail.google.com/mail' }, own).source, 'email');
is('google search', classifyTouch({ referrer: 'https://www.google.com/search?q=وظائف' }, own).source, 'google');
is('our own host is direct', classifyTouch({ referrer: 'https://brokersconnect.net/jobs' }, own).source, 'direct');
is('the host stored is the host, not the path', classifyTouch({ referrer: 'https://l.instagram.com/x' }, own).referrer, 'l.instagram.com');
is('a host with no scheme', hostOf('l.instagram.com'), 'l.instagram.com');

console.log('\n— click ids are a flag, never a value that is stored');
const ads = classifyTouch({ referrer: 'https://www.google.com/', gclid: true, utmCampaign: 'cairo' }, own);
is('a google click is ads', ads.source, 'google_ads');
is('the campaign is kept', ads.campaign, 'cairo');
is('the classified visit has no click id', Object.keys(ads).sort(), ['campaign', 'landingPath', 'medium', 'referrer', 'source']);
is('a meta click with no campaign is facebook', classifyTouch({ fbclid: true }, own).source, 'facebook');
is('an instagram campaign wins over a meta click', classifyTouch({ utmSource: 'instagram', fbclid: true }, own).source, 'instagram');

console.log('\n— the app, and the path');
is('the app wins over a referrer', classifyTouch({ inApp: true, referrer: 'https://www.google.com/' }, own).source, 'app');
is('the path drops the query', classifyTouch({ landingPath: '/jobs?gclid=abc' }, own).landingPath, '/jobs');
is('a full address keeps only its path', landingPathOf('https://brokersconnect.net/jobs?x=1'), '/jobs');
is('a protocol-relative path is not stored', landingPathOf('//evil.example/jobs'), null);
is('a backslash path is not stored', landingPathOf('/\\evil.example'), null);
is('an encoded protocol-relative path is not stored', landingPathOf('/%2f%2fevil.example'), null);

console.log('\n— the cookie keeps the first visit, and not a click id');
const first = serialiseTouch({
  referrer: 'https://l.instagram.com/x',
  gclid: true,
  landingPath: '/jobs?fbclid=secret',
  seenAt: '2026-10-01T00:00:00.000Z',
});
const later = serialiseTouch({ referrer: 'https://www.google.com/', seenAt: '2026-10-02T00:00:00.000Z' });
is('the stored visit is the instagram address', parseTouch(first)?.referrer, 'https://l.instagram.com/x');
is('a click id string is not in the cookie', first.includes('secret') || first.includes('Cjw'), false);
is('the flag is', parseTouch(first)?.gclid, true);
is('a later visit is a different value', first === later, false);
is(
  'another cookie that merely contains the name is ignored',
  touchFromCookieHeader(`not_bc_touch=${encodeURIComponent(first)}; theme=dark`),
  null,
);
is(
  'the named cookie is the one that is read',
  touchFromCookieHeader(`theme=dark; bc_touch=${encodeURIComponent(first)}`)?.referrer,
  'https://l.instagram.com/x',
);

const capture = readFileSync(new URL('../src/components/attribution/capture.tsx', import.meta.url), 'utf8');
const existingAt = capture.indexOf('if (existing)');
const readAt = capture.indexOf('utm_source');
is('a stored visit returns before a later page is read', existingAt > -1 && readAt > existingAt, true);

console.log('\n— an older account is left unknown');

function client(read, write = { error: null }) {
  const updates = [];
  return {
    updates,
    from() {
      return {
        select() {
          return { eq: () => ({ maybeSingle: async () => read }) };
        },
        update(payload) {
          updates.push(payload);
          return { eq: () => ({ is: async () => write }) };
        },
      };
    },
  };
}

const seen = '2026-10-27T12:00:00.000Z';
const fresh = client({ data: { created_at: '2026-10-27T11:58:00.000Z', first_seen_at: null, first_source: null }, error: null });
is('a new account is written', await writeFirstTouch(fresh, 'user', { referrer: 'https://l.instagram.com/x', seenAt: seen }, own), true);
is('as instagram', fresh.updates[0]?.first_source, 'instagram');
is('with no click id column', JSON.stringify(fresh.updates[0] ?? {}).includes('gclid'), false);

const old = client({ data: { created_at: '2024-01-01T00:00:00.000Z', first_seen_at: null, first_source: null }, error: null });
is('an account older than the visit stays unknown', await writeFirstTouch(old, 'user', { referrer: 'https://lm.facebook.com/', seenAt: seen }, own), true);
is('and nothing is written', old.updates.length, 0);

const filled = client({
  data: { created_at: '2026-10-27T11:58:00.000Z', first_seen_at: seen, first_source: 'direct' },
  error: null,
});
is('a second visit does not replace the first', await writeFirstTouch(filled, 'user', { referrer: 'https://www.google.com/', seenAt: seen }, own), true);
is('and writes nothing', filled.updates.length, 0);

const missing = client({ data: null, error: { code: '42703' } });
is('a database without the column can be tried again', await writeFirstTouch(missing, 'user', { seenAt: seen }, own), false);
is('a visit with no time is not stored', await writeFirstTouch(fresh, 'user', { referrer: 'https://www.google.com/' }, own), false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
