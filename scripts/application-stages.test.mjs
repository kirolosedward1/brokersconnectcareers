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
  timelineSteps,
  withWithdrawnLast,
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
