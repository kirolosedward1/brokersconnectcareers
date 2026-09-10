/**
 * The job ranking on the candidate dashboard.
 *
 *   node --experimental-strip-types scripts/match.test.mjs
 *
 * Pure functions, so this needs no database and no server. It is worth having
 * anyway: the ordering is the one place in the product that claims a listing
 * is relevant to somebody, and a scoring bug is invisible — the page still
 * renders three cards, just the wrong three, with a confident explanation
 * underneath.
 */
import { bandFor, scoreJob, rankJobs } from '../src/lib/match.ts';

let pass = 0;
let fail = 0;

function is(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const job = (track, district_id, experience_band) => ({ track, district_id, experience_band });

console.log('— years map to the band the product already shows');
is('0 years is a fresh graduate', bandFor(0), 'fresh_0_1');
is('1 year is junior', bandFor(1), 'junior_1_3');
is('3 years resolves upward, to mid', bandFor(3), 'mid_3_5');
is('5 years resolves upward, to senior', bandFor(5), 'senior_5_plus');
is('20 years is still senior', bandFor(20), 'senior_5_plus');

console.log('\n— a listing scores on what both sides actually typed');
const profile = { tracks: ['primary'], districtIds: [2], yearsExperience: 4 };
is('track, district and experience', scoreJob(job('primary', 2, 'mid_3_5'), profile).score, 5);
is('track alone', scoreJob(job('primary', 9, 'fresh_0_1'), profile).score, 2);
is('district alone', scoreJob(job('resale', 2, 'fresh_0_1'), profile).score, 2);
is('experience alone', scoreJob(job('resale', 9, 'mid_3_5'), profile).score, 1);
is('nothing in common', scoreJob(job('resale', 9, 'fresh_0_1'), profile).score, 0);

console.log('\n— the reasons name the match, so a card can be checked');
const reasons = scoreJob(job('primary', 2, 'mid_3_5'), profile).reasons;
is('the track it matched', reasons.track, 'primary');
is('the district it matched', reasons.districtId, 2);
is('and that the years fit', reasons.experience, true);

console.log('\n— ordering');
const board = [job('resale', 9, 'fresh_0_1'), job('primary', 2, 'mid_3_5'), job('primary', 9, 'fresh_0_1')];
is('best fit first', rankJobs(board, profile).ranked.map((r) => r.score), [5, 2, 0]);
is('and it says it personalised', rankJobs(board, profile).personalised, true);

/*
  The case that matters most, because it is what a brand-new consultant sees.
  An empty profile must not reshuffle the board and call it a recommendation:
  every score is zero, the newest-first order the caller passed in survives, and
  `personalised` is false so the page offers to fix the cause instead.
*/
const blank = rankJobs(board, { tracks: [], districtIds: [], yearsExperience: null });
is('an empty profile changes nothing', blank.ranked.map((r) => r.job.track), ['resale', 'primary', 'primary']);
is('and does not claim to be personalised', blank.personalised, false);
is('nulls are handled like empties', rankJobs(board, { tracks: null, districtIds: null, yearsExperience: null }).personalised, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
