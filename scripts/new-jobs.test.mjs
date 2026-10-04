/**
 * The day's notification about new listings (src/lib/new-jobs.ts).
 *
 *   node --experimental-strip-types scripts/new-jobs.test.mjs
 *
 * What one person hears once a day from their saved searches and followed
 * companies, and where it takes them: named after the one thing that found
 * listings, counted when several did, a listing found twice counted once. And
 * the turn's rules: only what was published since each search was last
 * looked at and not after the run began, less what the person applied to;
 * the cursors moving when the notice is written or there is nothing new, and
 * staying when today's already went out or anything failed. And the run's:
 * every new listing counted however many pages it takes (to a limit), and
 * the people taken from where the last run stopped, round to the start.
 */
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { newJobsNotice, publishedAfter, lookForNewJobs, boardSince, duePeople, BOARD_PAGES, APPLIED_CHUNK } = await import('../src/lib/new-jobs.ts');

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
  newJobsNotice([{ label: 'كل الوظائف', query: '', jobs: [job('a')] }]).href,
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
  const log = { recorded: [], advanced: [], boards: 0, searched: 0, since: [] };
  return {
    log,
    ctx: {
      cursor: CURSOR,
      firstLook: FIRST_LOOK,
      searches: async () => searches,
      role: async () => role,
      board: async (query, since) => {
        log.boards += 1;
        log.since.push(since);
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
  // Ten searches can find a thousand listings, and the lookup is a GET with
  // every id in its URL: past the gateway's limit it failed on every run.
  const many = Array.from({ length: 230 }, (_, i) => ({ id: `j${i}`, published_at: '2026-10-01T05:00:00+00:00', company: nile }));
  const { ctx, log } = context({
    searches: [SEARCHES[0]],
    board: { 'company=nile-co': many },
    applied: ['j3', 'j120', 'j229'],
  });
  const sizes = [];
  const lookup = ctx.applied;
  ctx.applied = async (person, ids) => {
    sizes.push(ids.length);
    return lookup(person, ids);
  };
  await lookForNewJobs('p', ctx);
  is(`230 listings are looked up ${APPLIED_CHUNK} at a time`, sizes, [50, 50, 50, 50, 30]);
  is('and one applied to in any of the lookups is left out', log.recorded[0].payload.count, 227);
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

{
  const { ctx, log } = context({ searches: SEARCHES, board: BOARD });
  await lookForNewJobs('p', ctx);
  is('each search asks the board for what is new since its own cursor', log.since, ['2026-09-30T07:17:00+00:00', FIRST_LOOK]);
}
{
  // Published two minutes after the run began, and seen by it: tomorrow's
  // news, when the cursor (the run's start) is behind it — and not today's too.
  const during = { id: 'during', published_at: '2026-10-01T07:19:00+00:00', company: nile };
  const board = { 'company=nile-co': [during, ...BOARD['company=nile-co']] };
  const { ctx, log } = context({ searches: [SEARCHES[0]], board });
  await lookForNewJobs('p', ctx);
  is('a listing published after the run began is left for tomorrow', log.recorded[0]?.payload.count, 1);
  const tomorrow = context({
    searches: [{ ...SEARCHES[0], bell_checked_at: CURSOR }],
    board,
  });
  tomorrow.ctx.cursor = '2026-10-02T07:17:00.000Z';
  await lookForNewJobs('p', tomorrow.ctx);
  is('and counted then, once', tomorrow.log.recorded[0]?.payload.count, 1);
}

console.log('\n— every new listing, page by page');
{
  const SINCE = '2026-10-01T00:00:00Z';
  // A board of `total` listings, newest first, twenty to a page; the first `fresh` are new.
  const board = (total, fresh) => {
    const all = Array.from({ length: total }, (_, i) => ({
      id: `j${i}`,
      published_at: i < fresh ? '2026-10-01T06:00:00Z' : '2026-09-29T06:00:00Z',
    }));
    const pageCount = Math.max(1, Math.ceil(total / 20));
    const asked = [];
    const page = async (n) => {
      asked.push(n);
      const shown = Math.min(n, pageCount);
      return { jobs: all.slice((shown - 1) * 20, shown * 20), page: shown, pageCount };
    };
    return { page, asked };
  };
  const count = (jobs) => jobs.filter((job) => publishedAfter(job.published_at, SINCE)).length;

  let b = board(50, 5);
  is('five new on the first page: one page read', [count(await boardSince(b.page, SINCE)), b.asked], [5, [1]]);
  b = board(80, 35);
  is('thirty-five new: two pages read, all thirty-five counted', [count(await boardSince(b.page, SINCE)), b.asked], [35, [1, 2]]);
  b = board(40, 40);
  is('every listing new: the last page is the end, not read twice', [count(await boardSince(b.page, SINCE)), b.asked], [40, [1, 2]]);
  b = board(400, 400);
  is(`a flood: ${BOARD_PAGES} pages and no more`, [count(await boardSince(b.page, SINCE)), b.asked.length], [BOARD_PAGES * 20, BOARD_PAGES]);
  b = board(0, 0);
  is('an empty board: one look', [count(await boardSince(b.page, SINCE)), b.asked], [0, [1]]);
}

console.log('\n— who is looked at, in what order');
{
  // Due searches, one row each, in candidate order: p2 has three, spanning a page.
  const ROWS = ['p1', 'p2', 'p2', 'p2', 'p3', 'p4', 'p5', 'p6'];
  const page = async (after, through) =>
    ROWS.filter((id) => (after === null || id > after) && (through === null || id <= through)).slice(0, 3);
  const all = async (resumeAfter) => {
    const order = [];
    for await (const person of duePeople(page, resumeAfter, 3)) order.push(person);
    return order;
  };
  is('from the start when the last run finished', await all(null), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  is('after where the last run stopped, then round to it', await all('p3'), ['p4', 'p5', 'p6', 'p1', 'p2', 'p3']);
  is('stopped at the last person: round from the start', await all('p6'), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);

  // Why: a run with room for three people, every day, over five people due daily.
  const due = ['a', 'b', 'c', 'd', 'e'];
  const fetch = async (after, through) =>
    due.filter((id) => (after === null || id > after) && (through === null || id <= through)).slice(0, 2);
  const seen = new Set();
  let resume = null;
  for (let day = 0; day < 2; day += 1) {
    const people = duePeople(fetch, resume, 2);
    let reached = null;
    for (let room = 3; room > 0; room -= 1) {
      const next = await people.next();
      if (next.done) break;
      reached = next.value;
      seen.add(reached);
    }
    resume = reached;
  }
  is('over two days, everybody is looked at', [...seen].sort(), due);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
