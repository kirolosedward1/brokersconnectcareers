/**
 * Where a notification may send its reader, and how its feed is paged.
 *
 *   node --experimental-strip-types scripts/notification-links.test.mjs
 *
 * The href in a notification row was written by the platform, but it is
 * followed later, by whoever holds the row then, and it lands in a redirect.
 * So the two things pinned here are the refusals: a link into the other half
 * of the site, and anything that could leave the site at all. The cursor is
 * pinned because it goes from a query string straight into a PostgREST filter.
 *
 * The bell's own rules — which rows it may show twice, how the badge counts,
 * and the relative time — are pure and live next to those.
 */
import { readFileSync } from 'node:fs';
import { createTranslator } from 'next-intl';
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { safeNotificationHref, decodeCursor, encodeCursor, afterCursorFilter } = await import(
  '../src/lib/notifications/links.ts'
);
const { bellBadge, dedupeFeed } = await import('../src/lib/notifications/feed.ts');
const { formatBellTime } = await import('../src/lib/notifications/relative.ts');

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

console.log('\n— a candidate is never sent into the employer console');
is('candidate → employer applicants', safeNotificationHref('/employer/jobs/x/applicants', 'candidate'), null);
is('candidate → admin', safeNotificationHref('/admin/jobs', 'candidate'), null);
is('candidate → own applications', safeNotificationHref('/dashboard/applications', 'candidate'), '/dashboard/applications');
is('candidate → a public listing', safeNotificationHref('/jobs/some-slug', 'candidate'), '/jobs/some-slug');

console.log('\n— an employer is never sent into candidate-only pages');
is('employer → candidate applications', safeNotificationHref('/dashboard/applications', 'employer'), null);
is('employer → candidate profile', safeNotificationHref('/dashboard/profile', 'employer'), null);
is('employer → their own account page, which is shared', safeNotificationHref('/dashboard/account', 'employer'), '/dashboard/account');
is('employer → the bell\'s list, which is shared', safeNotificationHref('/dashboard/notifications', 'employer'), '/dashboard/notifications');
is('candidate → the bell\'s list', safeNotificationHref('/dashboard/notifications', 'candidate'), '/dashboard/notifications');
is('employer → applicants', safeNotificationHref('/employer/jobs/x/applicants', 'employer'), '/employer/jobs/x/applicants');
is('employer → admin', safeNotificationHref('/admin', 'employer'), null);

console.log('\n— an admin sees both sides, as the route guards allow');
is('admin → employer', safeNotificationHref('/employer/jobs', 'admin'), '/employer/jobs');
is('admin → dashboard', safeNotificationHref('/dashboard', 'admin'), '/dashboard');

console.log('\n— nothing leaves the site');
for (const href of [
  'https://evil.test/x',
  '//evil.test/x',
  '/\\evil.test',
  'javascript:alert(1)',
  '/jobs/../admin',
  '/jobs/x\nLocation: https://evil.test',
  '/employerx',
  '/unknown/page',
  '',
  null,
]) {
  is(`refused: ${JSON.stringify(href)}`, safeNotificationHref(href, 'admin'), null);
}
is('a prefix is a whole segment, not a string prefix', safeNotificationHref('/dashboardx', 'candidate'), null);
is('a query string survives', safeNotificationHref('/notifications?link=gone', 'candidate'), '/notifications?link=gone');

console.log('\n— the bell');
is('no badge at zero', bellBadge(0), null);
is('no badge below zero', bellBadge(-1), null);
is('the count itself up to nine', bellBadge(9), '9');
is('above nine is 9+', bellBadge(10), '9+');
is('a folded row is not shown', dedupeFeed([
  { id: 'a', dedupe_key: 'k1', folded_into: null },
  { id: 'b', dedupe_key: 'k2', folded_into: 'a' },
]), [{ id: 'a', dedupe_key: 'k1', folded_into: null }]);
is('the same dedupe key keeps the newer row', dedupeFeed([
  { id: 'new', dedupe_key: 'same', folded_into: null },
  { id: 'old', dedupe_key: 'same', folded_into: null },
]), [{ id: 'new', dedupe_key: 'same', folded_into: null }]);
{
  const now = new Date('2026-10-26T12:00:00Z');
  const five = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  is('five minutes ago, Arabic', formatBellTime(five, 'ar', now), 'قبل 5 دقائق');
  is('five minutes ago, English', formatBellTime(five, 'en', now), '5 minutes ago');
  const ar = JSON.parse(readFileSync(new URL('../messages/ar.json', import.meta.url), 'utf8'));
  const en = JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8'));
  const tAr = createTranslator({ locale: 'ar', messages: ar, namespace: 'notifications' });
  const tEn = createTranslator({ locale: 'en', messages: en, namespace: 'notifications' });
  is('the Arabic label for three unread', tAr('bellUnread', { count: 3 }), 'الإشعارات، 3 غير مقروءة');
  is('the English label for three unread', tEn('bellUnread', { count: 3 }), 'Notifications, 3 unread');
  is('the Arabic empty state', tAr('bellEmpty'), 'لا توجد إشعارات بعد');
  is('the English empty state', tEn('bellEmpty'), 'No notifications yet.');
  is('the Arabic mark-all', tAr('bellMarkAll'), 'تحديد الكل كمقروء');
  is('the English mark-all', tEn('bellMarkAll'), 'Mark all as read');
  is('the Arabic load error', tAr('bellLoadError'), 'تعذّر تحميل الإشعارات');
  is('the English load error', tEn('bellLoadError'), "Couldn't load notifications.");
  is('the Arabic retry', tAr('bellRetry'), 'إعادة المحاولة');
  is('the English retry', tEn('bellRetry'), 'Try again');
}

console.log('\n— the cursor');
const cursor = { createdAt: '2026-09-27T10:41:13.168564+00:00', id: '11111111-1111-4111-8111-111111111111' };
is('round-trips', decodeCursor(encodeCursor(cursor)), cursor);
is('a garbage cursor is the first page', decodeCursor('nonsense'), null);
is('a cursor carrying filter syntax is refused',
  decodeCursor('2026-01-01),or(id.gt.0~11111111-1111-4111-8111-111111111111'), null);
is('a non-uuid id is refused', decodeCursor('2026-01-01T00:00:00Z~1 or 1=1'), null);
is('an array from a repeated query param is refused', decodeCursor(['a', 'b']), null);
is('the filter quotes the timestamp and breaks ties on id',
  afterCursorFilter(cursor),
  `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
