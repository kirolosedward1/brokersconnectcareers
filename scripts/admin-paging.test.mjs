/**
 * Where a console list sends somebody whose page came back empty.
 *
 *   node --experimental-strip-types scripts/admin-paging.test.mjs
 *
 * Resolving the last case on the last page refreshes that page under the same
 * URL. PostgREST answers an offset of exactly the total with no rows (it only
 * refuses one past the total), and the queues read through database functions
 * count their total over the rows they return, so the page read "nothing
 * waiting" — 0 of 0 — over a page one still full of work.
 */
const { hrefWith, pageAfterTheEnd } = await import('../src/lib/admin/params.ts');

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

console.log('— staying');
is('an empty first page is the answer: nothing is waiting', pageAfterTheEnd({ page: 1, rows: 0, total: 0 }), null);
is('a later page with rows stays', pageAfterTheEnd({ page: 2, rows: 1, total: 26 }), null);
is('a full later page stays', pageAfterTheEnd({ page: 3, rows: 25, total: 75 }), null);

console.log('\n— leaving an empty page');
is(
  '26 cases, the one on page 2 resolved: 25 left, page 2 empty → page 1',
  pageAfterTheEnd({ page: 2, rows: 0, total: 25 }),
  1,
);
is('the last page that has rows, not the first', pageAfterTheEnd({ page: 4, rows: 0, total: 60 }), 3);
is('a bookmarked page far past the end', pageAfterTheEnd({ page: 40, rows: 0, total: 60 }), 3);
is('in the page size the list uses: 40 at 20 a page end on page 2', pageAfterTheEnd({ page: 3, rows: 0, total: 40, size: 20 }), 2);
is(
  'a database function counts 0 over no rows: page 1, which counts again',
  pageAfterTheEnd({ page: 3, rows: 0, total: 0, size: 20 }),
  1,
);
is('no total at all: page 1', pageAfterTheEnd({ page: 2, rows: 0, total: null }), 1);
is(
  'never this page or a later one, whatever the total claims',
  pageAfterTheEnd({ page: 2, rows: 0, total: 500 }),
  1,
);

console.log('\n— the link it goes to');
is('page 1 carries no page', hrefWith('/admin/reports', { status: 'closed', type: 'job' }, { page: 1 }), '/admin/reports?status=closed&type=job');
is('a later page keeps the filters', hrefWith('/admin/jobs', { q: 'cairo', status: 'live' }, { page: 3 }), '/admin/jobs?q=cairo&status=live&page=3');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
