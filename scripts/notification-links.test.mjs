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
 */
const { safeNotificationHref, decodeCursor, encodeCursor, afterCursorFilter } = await import(
  '../src/lib/notifications/links.ts'
);

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
