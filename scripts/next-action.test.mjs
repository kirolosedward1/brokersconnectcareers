/**
 * Which card the employer console puts above everything else.
 *
 *   node --experimental-strip-types scripts/next-action.test.mjs
 *
 * The ordering is the whole logic, and until now nothing held it. The chain
 * grew to five branches inline in a page, where the property that matters —
 * for any given state, the same card, every time — was unassertable: a page
 * cannot be called.
 *
 * So the interesting cases here are not "does the ended card appear" but the
 * pairs: a state where two conditions are true at once, and which one wins.
 * That is what breaks when somebody inserts a branch in the natural place
 * rather than the right one.
 */

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

const { employerNextAction } = await import('../src/lib/employer-next-action.ts');

/** A company with nothing outstanding. Every case below is this, plus one fact. */
const QUIET = {
  has_company: true,
  live_jobs: 3,
  pending_jobs: 0,
  draft_jobs: 0,
  expiring_soon: 0,
  ended_jobs: 0,
  total_views: 120,
  seats_advertised: 7,
  applicants_total: 4,
  applicants_new: 0,
  applicants_unseen: 0,
  applicants_7d: 1,
  applicants_prev_7d: 2,
  credits: 0,
  verification: 'verified',
};

const kindOf = (state) => employerNextAction({ ...QUIET, ...state })?.kind ?? null;

console.log('— nothing to do is a real answer');
is('a company with nothing outstanding gets no card', kindOf({}), null);
is('and neither does an account with no company yet', employerNextAction({ has_company: false }), null);

console.log('\n— each condition on its own');
is('rejected paperwork', kindOf({ verification: 'rejected' }), 'verification');
is('applicants nobody has decided on', kindOf({ applicants_new: 3 }), 'applicants');
is('a listing ending this week', kindOf({ expiring_soon: 1 }), 'expiring');
is('a listing that has already ended', kindOf({ ended_jobs: 2 }), 'ended');
is('a draft nobody has sent', kindOf({ draft_jobs: 1 }), 'draft');

console.log('\n— and when two are true at once, which wins');
/*
  Ordered by the cost of ignoring the thing, which is not the order somebody
  would naturally write them in. These are the assertions that fail when a
  branch is inserted in the wrong place — and inserting one in the wrong place
  is silent: the card still renders, just the wrong card.
*/
is(
  'rejected paperwork beats everything, because it blocks everything',
  kindOf({ verification: 'rejected', applicants_new: 9, expiring_soon: 4, ended_jobs: 2, draft_jobs: 1 }),
  'verification',
);
is(
  'people waiting on a reply beat anything about the company itself',
  kindOf({ applicants_new: 1, expiring_soon: 4, ended_jobs: 2, draft_jobs: 1 }),
  'applicants',
);
is(
  'a listing that can still be saved beats one that is already gone',
  kindOf({ expiring_soon: 1, ended_jobs: 5 }),
  'expiring',
);
is(
  'and a listing that is gone beats a draft, which nobody is waiting on',
  kindOf({ ended_jobs: 1, draft_jobs: 3 }),
  'ended',
);

console.log('\n— the count the card interpolates is the one it is about');
{
  const action = employerNextAction({ ...QUIET, ended_jobs: 2, draft_jobs: 7 });
  is('ended carries the ended count, not another branch\'s', action.count, 2);
  is('and names the copy trio the page will read', action.key, 'Ended');
}
{
  // `verification` has no number in its words, so a count would be a number
  // with nothing to count — 0 rather than a stray total the card ignores.
  const action = employerNextAction({ ...QUIET, verification: 'rejected', applicants_new: 4 });
  is('a card with no number in its copy carries no count', action.count, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
