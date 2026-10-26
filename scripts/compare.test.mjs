/**
 * The saved-compare rule shared with the app.
 *
 *   node --experimental-strip-types scripts/compare.test.mjs
 */
import { COMPARE_MAX, COMPARE_MIN, bestOf, parseCompareIds, togglePick } from '../src/lib/saved/compare.ts';

let pass = 0;
let fail = 0;
function is(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

is('two to three', [COMPARE_MIN, COMPARE_MAX], [2, 3]);

let picked = [];
picked = togglePick(picked, 'a').picked;
picked = togglePick(picked, 'b').picked;
const full = togglePick(picked, 'c');
is('a third is kept', full.picked, ['a', 'b', 'c']);
is('a fourth is refused', togglePick(full.picked, 'd'), { picked: ['a', 'b', 'c'], refused: true });
is('tapping again takes it out', togglePick(full.picked, 'b').picked, ['a', 'c']);

is('ids stay in order, without repeats, at most three', parseCompareIds(['b', 'a,b,c,d']), ['b', 'a', 'c']);
is('one id', parseCompareIds('only'), ['only']);

const jobs = [
  { id: 'low', basic_salary_max: 1000, basic_salary_min: null, commission_type: 'percentage', commission_value: 1, leads_source: 'self_generated', seats: 1 },
  { id: 'high', basic_salary_max: null, basic_salary_min: 5000, commission_type: 'percentage', commission_value: 3, leads_source: 'company_provided', seats: 4 },
  { id: 'mid', basic_salary_max: 2000, basic_salary_min: null, commission_type: 'fixed', commission_value: 9, leads_source: 'hybrid', seats: 4 },
];
const best = bestOf(jobs);
is('highest salary', [...best.salary], ['high']);
is('stated percentage only', [...best.commission], ['high']);
is('the company brings the clients', [...best.leads], ['high']);
is('a tie for the most seats marks both', [...best.seats].sort(), ['high', 'mid']);
is('everyone equal is nobody\'s win', [...bestOf([{ ...jobs[0], id: 'a', seats: 2 }, { ...jobs[1], id: 'b', seats: 2 }]).seats], []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
