/**
 * Withdrawn applications, as the broker list and the candidate timeline draw them.
 *
 *   node --experimental-strip-types scripts/application-stages.test.mjs
 */
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const {
  APPLICATION_STAGES,
  PIPELINE_STAGES,
  WITHDRAWN_BADGE,
  WITHDRAWN_TEXT_DARK,
  canWithdraw,
  compareInboxRows,
  excludeWithdrawn,
  orderInbox,
  standingApplicantCount,
  applicationProgress,
  timelineSteps,
  withWithdrawnLast,
  withdrawnAtMissing,
  withdrawnStatusMissing,
} = await import('../src/lib/application-stages.ts');

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

console.log('— the badge is the specified pair, and the card text can be read on a dark surface');
is('size, weight, colours, radius', WITHDRAWN_BADGE, {
  color: '#5B6475',
  background: '#F2F4F7',
  radius: 6,
  fontSize: 12,
  fontWeight: 500,
});
is('dark card text', WITHDRAWN_TEXT_DARK, '#C5CAD3');

console.log('\n— withdrawn is a status, and not a stage an employer moves');
is('pipeline', [...PIPELINE_STAGES], ['new', 'shortlisted', 'interview', 'hired', 'rejected']);
is('list order ends with withdrawn', [...APPLICATION_STAGES], [...PIPELINE_STAGES, 'withdrawn']);

console.log('\n— withdrawal is offered only while the outcome is open');
is('new', canWithdraw('new'), true);
is('shortlisted', canWithdraw('shortlisted'), true);
is('interview', canWithdraw('interview'), false);
is('hired', canWithdraw('hired'), false);
is('rejected', canWithdraw('rejected'), false);
is('withdrawn', canWithdraw('withdrawn'), false);

console.log('\n— withdrawn rows keep their own order and follow the standing ones');
is(
  'order',
  withWithdrawnLast([
    { id: 'a', status: 'new' },
    { id: 'b', status: 'withdrawn' },
    { id: 'c', status: 'shortlisted' },
    { id: 'd', status: 'withdrawn' },
  ]).map((row) => row.id),
  ['a', 'c', 'b', 'd'],
);

console.log('\n— a withdrawn timeline stops at the decision, and only marks seen when it was');
const created = '2026-10-01T10:00:00.000Z';
is(
  'unseen',
  timelineSteps({ status: 'withdrawn', created_at: created, employer_viewed_at: null }),
  [
    { key: 'sent', state: 'done', date: created },
    { key: 'seen', state: 'ahead', date: null },
    { key: 'shortlisted', state: 'ahead', date: null },
    { key: 'decision', state: 'stopped', date: null },
  ],
);
const seenAt = '2026-10-02T10:00:00.000Z';
is(
  'seen',
  timelineSteps({ status: 'withdrawn', created_at: created, employer_viewed_at: seenAt })[1],
  { key: 'seen', state: 'done', date: seenAt },
);

console.log('\n— a withdrawal is not an applicant');
is(
  'count',
  standingApplicantCount([
    { status: 'new' },
    { status: 'withdrawn' },
    { status: 'hired' },
    { status: 'withdrawn' },
  ]),
  2,
);
{
  const asked = [];
  const query = {
    neq(column, value) {
      asked.push([column, value]);
      return query;
    },
  };
  excludeWithdrawn(query);
  is('the count filter', asked, [['status', 'withdrawn']]);
}

console.log('\n— the inbox sorts withdrawn last before it limits');
{
  const calls = [];
  const query = {
    order(column, options) {
      calls.push({ column, ...options });
      return query;
    },
    limit(n) {
      calls.push({ limit: n });
      return query;
    },
  };
  orderInbox(query).limit(200);
  is('order, then the cap', calls, [
    { column: 'withdrawn_at', ascending: true, nullsFirst: true },
    { column: 'created_at', ascending: false },
    { limit: 200 },
  ]);

  const rows = [
    { id: 'older-open', status: 'new', created_at: '2026-01-01T00:00:00Z', withdrawn_at: null },
    { id: 'newer-withdrawn', status: 'withdrawn', created_at: '2026-03-01T00:00:00Z', withdrawn_at: '2026-03-02T00:00:00Z' },
    { id: 'newer-open', status: 'shortlisted', created_at: '2026-02-01T00:00:00Z', withdrawn_at: null },
  ];
  const page = [...rows].sort(compareInboxRows).slice(0, 2).map((row) => row.id);
  is('the cap keeps both open applications', page, ['newer-open', 'older-open']);
  const after = withWithdrawnLast(
    [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 2),
  ).map((row) => row.id);
  is('sorting after the cap drops the older open application', after, ['newer-open', 'newer-withdrawn']);
}

console.log('\n— a missing column or enum is the database before the migration, not a broken read');
is('no withdrawn_at yet', withdrawnAtMissing({ code: '42703', message: 'column applications.withdrawn_at does not exist' }), true);
is('schema cache', withdrawnAtMissing({ code: 'PGRST204', message: 'Could not find the withdrawn_at column' }), true);
is('some other missing column', withdrawnAtMissing({ code: '42703', message: 'column applications.other does not exist' }), false);
is('withdrawn is not a status yet', withdrawnStatusMissing({ code: '22P02', message: 'invalid input value for enum application_status: "withdrawn"' }), true);
is('a real failure', withdrawnStatusMissing({ code: '57014', message: 'canceling statement due to statement timeout' }), false);

console.log('\n— the card’s pill and bar come from one progress');
{
  const created = '2026-10-01T10:00:00.000Z';
  const viewed = '2026-10-02T08:00:00.000Z';
  const shortAt = '2026-10-03T09:00:00.000Z';
  const decided = '2026-10-04T11:00:00.000Z';
  const withdrawnAt = '2026-10-05T12:00:00.000Z';
  const base = { created_at: created, employer_viewed_at: null, withdrawn_at: null, events: [] };
  const shape = (progress) => ({
    pill: progress.pill,
    summary: progress.summary,
    summaryDate: progress.summaryDate,
    segments: progress.segments.map((segment) => ({ key: segment.key, tone: segment.tone, date: segment.date })),
  });

  is(
    'just sent',
    shape(applicationProgress({ ...base, status: 'new' })),
    {
      pill: 'new',
      summary: 'sent',
      summaryDate: created,
      segments: [
        { key: 'sent', tone: 'done', date: created },
        { key: 'seen', tone: 'current', date: null },
        { key: 'shortlisted', tone: 'upcoming', date: null },
        { key: 'decision', tone: 'upcoming', date: null },
      ],
    },
  );

  is(
    'seen, still open',
    shape(applicationProgress({ ...base, status: 'new', employer_viewed_at: viewed })),
    {
      pill: 'review',
      summary: 'seen',
      summaryDate: viewed,
      segments: [
        { key: 'sent', tone: 'done', date: created },
        { key: 'seen', tone: 'done', date: viewed },
        { key: 'shortlisted', tone: 'current', date: null },
        { key: 'decision', tone: 'upcoming', date: null },
      ],
    },
  );

  const shortlisted = applicationProgress({
    ...base,
    status: 'shortlisted',
    employer_viewed_at: viewed,
    events: [{ from_status: 'new', to_status: 'shortlisted', created_at: shortAt }],
  });
  is('shortlisted', shape(shortlisted), {
    pill: 'review',
    summary: 'shortlisted',
    summaryDate: shortAt,
    segments: [
      { key: 'sent', tone: 'done', date: created },
      { key: 'seen', tone: 'done', date: viewed },
      { key: 'shortlisted', tone: 'done', date: shortAt },
      { key: 'decision', tone: 'current', date: null },
    ],
  });
  is('the shortlist date is the event, not the day it was sent', shortlisted.segments[2].date === created, false);

  is(
    'interview is still in review, waiting on the decision',
    shape(applicationProgress({
      ...base,
      status: 'interview',
      employer_viewed_at: viewed,
      events: [
        { from_status: 'new', to_status: 'shortlisted', created_at: shortAt },
        { from_status: 'shortlisted', to_status: 'interview', created_at: '2026-10-03T18:00:00.000Z' },
      ],
    })),
    {
      pill: 'review',
      summary: 'shortlisted',
      summaryDate: shortAt,
      segments: [
        { key: 'sent', tone: 'done', date: created },
        { key: 'seen', tone: 'done', date: viewed },
        { key: 'shortlisted', tone: 'done', date: shortAt },
        { key: 'decision', tone: 'current', date: null },
      ],
    },
  );

  const rejectedEarly = applicationProgress({
    ...base,
    status: 'rejected',
    employer_viewed_at: viewed,
    events: [{ from_status: 'new', to_status: 'rejected', created_at: decided }],
  });
  is('rejected after it was seen, shortlist dropped', shape(rejectedEarly), {
    pill: 'rejected',
    summary: 'rejected',
    summaryDate: decided,
    segments: [
      { key: 'sent', tone: 'done', date: created },
      { key: 'seen', tone: 'done', date: viewed },
      { key: 'decision', tone: 'rejected', date: decided },
    ],
  });
  is('only the final segment is the rejection', rejectedEarly.segments.filter((segment) => segment.tone === 'rejected').map((segment) => segment.key), ['decision']);

  is(
    'rejected after the shortlist',
    shape(applicationProgress({
      ...base,
      status: 'rejected',
      employer_viewed_at: viewed,
      events: [
        { from_status: 'new', to_status: 'shortlisted', created_at: shortAt },
        { from_status: 'shortlisted', to_status: 'rejected', created_at: decided },
      ],
    })),
    {
      pill: 'rejected',
      summary: 'rejected',
      summaryDate: decided,
      segments: [
        { key: 'sent', tone: 'done', date: created },
        { key: 'seen', tone: 'done', date: viewed },
        { key: 'shortlisted', tone: 'done', date: shortAt },
        { key: 'decision', tone: 'rejected', date: decided },
      ],
    },
  );

  is(
    'a rejection with no view stamp does not borrow the rejection time for “seen”',
    applicationProgress({
      ...base,
      status: 'rejected',
      events: [{ from_status: 'new', to_status: 'rejected', created_at: decided }],
    }).segments[1],
    { key: 'seen', tone: 'done', date: null },
  );

  is(
    'accepted',
    shape(applicationProgress({
      ...base,
      status: 'hired',
      employer_viewed_at: viewed,
      events: [
        { from_status: 'new', to_status: 'shortlisted', created_at: shortAt },
        { from_status: 'shortlisted', to_status: 'hired', created_at: decided },
      ],
    })),
    {
      pill: 'hired',
      summary: 'hired',
      summaryDate: decided,
      segments: [
        { key: 'sent', tone: 'done', date: created },
        { key: 'seen', tone: 'done', date: viewed },
        { key: 'shortlisted', tone: 'done', date: shortAt },
        { key: 'decision', tone: 'done', date: decided },
      ],
    },
  );

  is(
    'accepted with no hire event has no invented decision date',
    applicationProgress({ ...base, status: 'hired', employer_viewed_at: viewed }).summaryDate,
    null,
  );

  // Migration 42 and the demo seed write one event, from_status null, at the
  // row's current status. The seed stamps that event at seed time, which is
  // not the application date. Those steps stay done and undated.
  const seedTime = '2026-10-26T09:00:00.000Z';
  const backfill = (status) => ({
    ...base,
    status,
    events: [{ from_status: null, to_status: status, created_at: seedTime }],
  });
  const noFakeDate = (progress) => {
    const dates = [progress.summaryDate, ...progress.segments.map((segment) => segment.date)];
    return !dates.includes(seedTime) && dates.filter((date) => date === created).length === 1;
  };

  const backfilledShortlist = applicationProgress(backfill('shortlisted'));
  is('backfilled shortlist stays in review with no step date', shape(backfilledShortlist), {
    pill: 'review',
    summary: 'shortlisted',
    summaryDate: null,
    segments: [
      { key: 'sent', tone: 'done', date: created },
      { key: 'seen', tone: 'done', date: null },
      { key: 'shortlisted', tone: 'done', date: null },
      { key: 'decision', tone: 'current', date: null },
    ],
  });
  is('backfilled shortlist does not borrow the seed time or the sent day', noFakeDate(backfilledShortlist), true);

  const backfilledAtCreated = applicationProgress({
    ...base,
    status: 'shortlisted',
    events: [{ from_status: null, to_status: 'shortlisted', created_at: created }],
  });
  is('a backfill stamped at created_at still leaves the shortlist undated', backfilledAtCreated.segments[2].date, null);
  is('a backfill stamped at created_at does not date the summary', backfilledAtCreated.summaryDate, null);

  const backfilledHired = applicationProgress(backfill('hired'));
  is('backfilled hire is done with no decision date', shape(backfilledHired), {
    pill: 'hired',
    summary: 'hired',
    summaryDate: null,
    segments: [
      { key: 'sent', tone: 'done', date: created },
      { key: 'seen', tone: 'done', date: null },
      { key: 'shortlisted', tone: 'done', date: null },
      { key: 'decision', tone: 'done', date: null },
    ],
  });
  is('backfilled hire does not borrow the seed time or the sent day', noFakeDate(backfilledHired), true);

  const backfilledRejected = applicationProgress(backfill('rejected'));
  is('backfilled rejection drops the shortlist and dates nothing but sent', shape(backfilledRejected), {
    pill: 'rejected',
    summary: 'rejected',
    summaryDate: null,
    segments: [
      { key: 'sent', tone: 'done', date: created },
      { key: 'seen', tone: 'done', date: null },
      { key: 'decision', tone: 'rejected', date: null },
    ],
  });
  is('backfilled rejection does not borrow the seed time or the sent day', noFakeDate(backfilledRejected), true);

  is(
    'a real shortlist still dates the step when an earlier null event names the same status',
    applicationProgress({
      ...base,
      status: 'shortlisted',
      employer_viewed_at: viewed,
      events: [
        { from_status: null, to_status: 'shortlisted', created_at: seedTime },
        { from_status: 'new', to_status: 'shortlisted', created_at: shortAt },
      ],
    }).summaryDate,
    shortAt,
  );

  is(
    'withdrawn before anyone looked',
    shape(applicationProgress({ ...base, status: 'withdrawn', withdrawn_at: withdrawnAt })),
    {
      pill: 'withdrawn',
      summary: 'withdrawn',
      summaryDate: withdrawnAt,
      segments: [{ key: 'sent', tone: 'withdrawn', date: created }],
    },
  );

  is(
    'withdrawn after it was seen',
    shape(applicationProgress({
      ...base,
      status: 'withdrawn',
      employer_viewed_at: viewed,
      withdrawn_at: withdrawnAt,
    })),
    {
      pill: 'withdrawn',
      summary: 'withdrawn',
      summaryDate: withdrawnAt,
      segments: [
        { key: 'sent', tone: 'withdrawn', date: created },
        { key: 'seen', tone: 'withdrawn', date: viewed },
      ],
    },
  );

  is(
    'withdrawn from the shortlist',
    shape(applicationProgress({
      ...base,
      status: 'withdrawn',
      employer_viewed_at: viewed,
      withdrawn_at: withdrawnAt,
      events: [
        { from_status: 'new', to_status: 'shortlisted', created_at: shortAt },
        { from_status: 'shortlisted', to_status: 'withdrawn', created_at: withdrawnAt },
      ],
    })),
    {
      pill: 'withdrawn',
      summary: 'withdrawn',
      summaryDate: withdrawnAt,
      segments: [
        { key: 'sent', tone: 'withdrawn', date: created },
        { key: 'seen', tone: 'withdrawn', date: viewed },
        { key: 'shortlisted', tone: 'withdrawn', date: shortAt },
      ],
    },
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
