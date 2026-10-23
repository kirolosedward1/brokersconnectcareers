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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
