/**
 * The day's notification about new listings (src/lib/new-jobs.ts).
 *
 *   node --experimental-strip-types scripts/new-jobs.test.mjs
 *
 * What one person hears once a day from their saved searches and followed
 * companies, and where it takes them: named after the one thing that found
 * listings, counted when several did, a listing found twice counted once. And
 * the turn's rules: only what was published since each search was last
 * looked at, less what the person applied to; the cursors moving when the
 * notice is written or there is nothing new, and staying when today's already
 * went out or anything failed.
 */
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { newJobsNotice, publishedAfter, lookForNewJobs } = await import('../src/lib/new-jobs.ts');

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

const nile = { slug: 'nile-co', name_ar: 'شركة النيل', name_en: 'Nile Co' };
const delta = { slug: 'delta', name_ar: 'دلتا', name_en: null };
const job = (id, company = nile) => ({ id, company });

console.log('— the notice');
is('nothing found, nothing said', newJobsNotice([]), null);
is('searches that found nothing say nothing', newJobsNotice([{ label: 'x', query: 'track=primary', jobs: [] }]), null);

is(
  'one followed company names the company and links to it',
  newJobsNotice([{ label: 'Nile Co', query: 'company=nile-co', jobs: [job('a'), job('b')] }]),
  {
    payload: { count: 2, source: 'follow', slug: 'nile-co', name_ar: 'شركة النيل', name_en: 'Nile Co' },
    href: '/companies/nile-co',
  },
);
is(
  'a slug is encoded into the link',
  newJobsNotice([{ label: 'x', query: 'company=a%20b', jobs: [job('a', { slug: 'a b', name_ar: 'أ ب', name_en: null })] }]).href,
  '/companies/a%20b',
);
is(
  'a follow whose listings carry no company is still told, without a name',
  newJobsNotice([{ label: 'x', query: 'company=nile-co', jobs: [job('a', null)] }]).payload,
  { count: 1, source: 'follow', slug: 'nile-co' },
);
is(
  'one search names the search and links to the board with its filters',
  newJobsNotice([{ label: 'مبيعات التجمع', query: 'track=primary&district=new-cairo', jobs: [job('a'), job('b'), job('c')] }]),
  { payload: { count: 3, source: 'search', label: 'مبيعات التجمع' }, href: '/jobs?track=primary&district=new-cairo' },
);
is(
  'a search with no filters links to the board itself',
  newJobsNotice([{ label: 'كل الوظايف', query: '', jobs: [job('a')] }]).href,
  '/jobs',
);
is(
  'only one of two finding something is still that one',
  newJobsNotice([
    { label: 'Nile Co', query: 'company=nile-co', jobs: [job('a')] },
    { label: 'x', query: 'track=resale', jobs: [] },
  ]).payload.source,
  'follow',
);
is(
  'several finding something are counted, and link to the saved searches',
  newJobsNotice([
    { label: 'Nile Co', query: 'company=nile-co', jobs: [job('a'), job('b')] },
    { label: 'Delta', query: 'company=delta', jobs: [job('c', delta)] },
  ]),
  { payload: { count: 3, source: 'mixed' }, href: '/dashboard/saved' },
);
is(
  'a listing two searches found counts once',
  newJobsNotice([
    { label: 'Nile Co', query: 'company=nile-co', jobs: [job('a'), job('b')] },
    { label: 'primary', query: 'track=primary', jobs: [job('b'), job('c')] },
  ]).payload.count,
  3,
);

console.log('\n— published after');
is('a later instant is after', publishedAfter('2026-10-01T07:00:00.000Z', '2026-10-01T06:59:59.999Z'), true);
is('the same instant is not', publishedAfter('2026-10-01T07:00:00+00:00', '2026-10-01T07:00:00.000Z'), false);
is(
  'an offset is read as an instant, not compared as text',
  // 09:59:59 in Cairo is 06:59:59 UTC: before 07:00, though "09" sorts after "07".
  publishedAfter('2026-10-01T09:59:59+03:00', '2026-10-01T07:00:00Z'),
  false,
);
is('another time zone is the same instant', publishedAfter('2026-10-01T10:00:01+03:00', '2026-10-01T07:00:00Z'), true);
is(
  "PostgREST's microseconds read beside JavaScript's milliseconds",
  publishedAfter('2026-10-01T07:00:00.123456+00:00', '2026-10-01T07:00:00.122Z'),
  true,
);
is('no date is never after', publishedAfter(null, '2026-10-01T07:00:00Z'), false);
is('nor is a date that does not parse', publishedAfter('soon', '2026-10-01T07:00:00Z'), false);

console.log("\n— one person's turn");
const CURSOR = '2026-10-01T07:17:00.000Z';
const FIRST_LOOK = '2026-09-30T07:17:00.000Z';

/** A context over fixed data that records what the turn did. */
function context({ role = 'candidate', searches, board, applied = [], recorded = 'n1', throwOn = null }) {
  const log = { recorded: [], advanced: [], boards: 0, searched: 0 };
  return {
    log,
    ctx: {
      cursor: CURSOR,
      firstLook: FIRST_LOOK,
      searches: async () => searches,
      role: async () => role,
      board: async (query) => {
        log.boards += 1;
        if (throwOn === 'board') throw new Error('board down');
        return board[query] ?? [];
      },
      applied: async (_person, ids) => applied.filter((id) => ids.includes(id)),
      record: async (_person, notice) => {
        log.recorded.push(notice);
        return recorded;
      },
      advance: async (ids, at) => {
        log.advanced.push({ ids, at });
      },
      onSearch: () => {
        log.searched += 1;
      },
    },
  };
}

const SEARCHES = [
  { id: 's1', label: 'Nile Co', query: 'company=nile-co', bell_checked_at: '2026-09-30T07:17:00+00:00' },
  { id: 's2', label: 'مبيعات', query: 'track=primary', bell_checked_at: null },
];
const BOARD = {
  'company=nile-co': [
    { id: 'new1', published_at: '2026-10-01T05:00:00+00:00', company: nile },
    { id: 'old1', published_at: '2026-09-29T05:00:00+00:00', company: nile },
  ],
  'track=primary': [
    { id: 'new2', published_at: '2026-09-30T20:00:00+00:00', company: delta },
    // Before the first look's window: a search new to the job looks back a day, no further.
    { id: 'old2', published_at: '2026-09-30T07:00:00+00:00', company: delta },
  ],
};

{
  const { ctx, log } = context({ searches: SEARCHES, board: BOARD });
  is('new listings from two searches: told', await lookForNewJobs('p', ctx), 'notified');
  is('both searches were run', [log.boards, log.searched], [2, 2]);
  is('what each found since it was last looked at, counted once', log.recorded[0], {
    payload: { count: 2, source: 'mixed' },
    href: '/dashboard/saved',
  });
  is('and both cursors moved to the run start', log.advanced, [{ ids: ['s1', 's2'], at: CURSOR }]);
}
{
  const { ctx, log } = context({ searches: SEARCHES, board: BOARD, applied: ['new2'] });
  await lookForNewJobs('p', ctx);
  is('a listing already applied to is left out', log.recorded[0].payload, {
    count: 1,
    source: 'follow',
    slug: 'nile-co',
    name_ar: 'شركة النيل',
    name_en: 'Nile Co',
  });
}
{
  const { ctx, log } = context({ searches: SEARCHES, board: BOARD, recorded: null });
  is("today's notice already out: nothing more", await lookForNewJobs('p', ctx), 'already_today');
  is('and the cursors stay, so these are tomorrow’s news', log.advanced, []);
}
{
  const { ctx, log } = context({ searches: SEARCHES, board: { 'company=nile-co': [BOARD['company=nile-co'][1]] } });
  is('nothing new: nothing said', await lookForNewJobs('p', ctx), 'nothing_new');
  is('nothing recorded', log.recorded.length, 0);
  is('but the cursors move', log.advanced.length, 1);
}
{
  const { ctx, log } = context({ role: 'employer', searches: SEARCHES, board: BOARD });
  is('no longer a candidate: not told', await lookForNewJobs('p', ctx), 'not_candidates');
  is('without running the searches', log.boards, 0);
  is('their rows go to the back of the line', log.advanced.length, 1);
}
{
  const { ctx, log } = context({ searches: [], board: BOARD });
  is('no searches with alerts on: nothing to do', await lookForNewJobs('p', ctx), 'nothing_new');
  is('and nothing to move', log.advanced.length, 0);
}
{
  const { ctx, log } = context({ searches: SEARCHES, board: BOARD, throwOn: 'board' });
  let threw = false;
  try {
    await lookForNewJobs('p', ctx);
  } catch {
    threw = true;
  }
  is('a failure is thrown to the run', threw, true);
  is('and the cursors stay, so the next run tries again', log.advanced, []);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
