/**
 * The board's active filters, as the website and the app both list them.
 *
 *   node --experimental-strip-types scripts/job-filters.test.mjs
 *
 * activeFilterList() decides the chips a reader undoes and, on an empty board,
 * which filters are tried when suggesting "without X (n)". The page and the
 * mobile endpoint both take it from here, so what is pinned is the order, the
 * keys, and that each entry's `without` removes exactly that one value.
 */
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { activeFilterList, parseJobFilters, serializeJobFilters, EMPTY_FILTERS } = await import(
  '../src/lib/job-filters.ts'
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

console.log('— an unfiltered board has nothing to undo');
is('no entries', activeFilterList(EMPTY_FILTERS), []);

console.log('\n— every filter, in the order the board shows them');
const everything = parseJobFilters({
  q: 'مبيعات',
  track: ['primary', 'resale'],
  district: 'new-cairo',
  gov: 'cairo',
  ctype: 'developer',
  leads: 'company_provided',
  salary: 'yes',
  pay: '10000',
  comm: 'percentage',
  posted: '7',
  exp: 'junior_1_3',
  type: 'full_time',
  company: 'nile-123456',
  sort: 'salary',
  page: '3',
});
const list = activeFilterList(everything);
is(
  'keys in order',
  list.map((filter) => filter.key),
  [
    'q',
    'track-primary',
    'track-resale',
    'district-new-cairo',
    'gov',
    'ctype-developer',
    'leads-company_provided',
    'salary',
    'pay',
    'comm-percentage',
    'posted',
    'exp-junior_1_3',
    'type-full_time',
  ],
);
is('the pinned company is not a chip', list.some((filter) => filter.value === 'nile-123456'), false);
is('sort and page are not chips', list.some((filter) => filter.key === 'sort' || filter.key === 'page'), false);

console.log('\n— each entry takes away exactly its own value');
const byKey = Object.fromEntries(list.map((filter) => [filter.key, filter]));
is('one of two tracks', byKey['track-primary'].without, { tracks: ['resale'] });
is('the other one', byKey['track-resale'].without, { tracks: ['primary'] });
is('the keyword', byKey.q.without, { q: '' });
is('the governorate', byKey.gov.without, { governorateSlug: null });
is('has-a-basic', byKey.salary.without, { hasBasicSalary: null });
is('the minimum pay', byKey.pay.without, { minSalary: null });
is('posted within', byKey.posted.without, { postedWithin: null });

console.log('\n— the values are the model\'s, for the caller to put words to');
is('salary "no" reads as false, not as absent', activeFilterList(parseJobFilters({ salary: 'no' }))[0].value, false);
is('the pay step is a number', byKey.pay.value, 10000);
is('the posted window is a number', byKey.posted.value, 7);

console.log('\n— dropping an entry and serialising gives the board without it');
const dropped = serializeJobFilters({ ...everything, ...byKey['track-primary'].without, page: 1 });
is('the other track stays', dropped.getAll('track'), ['resale']);
is('everything else stays', dropped.get('district'), 'new-cairo');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
