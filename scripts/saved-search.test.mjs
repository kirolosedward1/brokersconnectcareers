/**
 * Following a company, which is a saved search wearing a different word.
 *
 *   node --experimental-strip-types scripts/saved-search.test.mjs
 *
 * There is no follows table, on purpose: the weekly alert job, the unsubscribe
 * link, the ten-row cap and the alert switch all already exist for saved
 * searches, and a second mechanism would be a second thing to keep in step.
 * What that costs is one rule the type system cannot hold — a follow and a
 * hand-built `/jobs?company=<slug>` search must canonicalise to the same
 * string, or the two arrive as separate rows and the same email goes out
 * twice. That rule is what most of this file is about.
 *
 * The other half is the filter value itself. `?company=` is the only board
 * filter that is a free string rather than a member of a fixed list, and it
 * does not stop at the query — it is stored, and replayed a week later by a
 * cron job running as nobody.
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

const { followQuery, followedCompany, toCanonicalQuery, hasFilters, queryParams } = await import(
  '../src/lib/saved-search.ts'
);
const { companySlugOrNull } = await import('../src/lib/search/company-slug.ts');

/**
 * The empty filter set, spelled out here rather than imported.
 *
 * Written out rather than imported so each assertion reads on its own — and
 * if a filter is ever added to the model without appearing here, the
 * round-trip assertions below stop proving what they claim, so the last test
 * in this file checks this against the real EMPTY_FILTERS in job-filters.ts.
 */
const NONE = {
  q: '',
  tracks: [],
  leadsSources: [],
  experienceBands: [],
  employmentTypes: [],
  districtSlugs: [],
  governorateSlug: null,
  hasBasicSalary: null,
  minSalary: null,
  commissionTypes: [],
  postedWithin: null,
  companySlug: null,
  companyTypes: [],
  sort: 'newest',
  page: 1,
};

console.log('— a follow and the search that produces it are one row');
is(
  'the canonicaliser agrees with followQuery',
  toCanonicalQuery({ ...NONE, companySlug: 'alrwad-482913' }),
  followQuery('alrwad-482913'),
);
is(
  'and the page and sort a reader happened to be on do not change it',
  toCanonicalQuery({ ...NONE, companySlug: 'alrwad-482913', sort: 'salary', page: 4 }),
  followQuery('alrwad-482913'),
);
is('a company filter is something worth saving', hasFilters({ ...NONE, companySlug: 'x-1' }), true);

console.log('\n— what counts as a follow, read back off the stored query');
is('the row the follow button writes', followedCompany(followQuery('alrwad-482913')), 'alrwad-482913');
is('an ordinary unfiltered search', followedCompany(''), null);
is('a search that filters on something else', followedCompany('track=primary'), null);
/*
  The one that matters. A search for this brokerage's junior roles in Nasr City
  is a search, not a follow — drawing it as one would promise alerts about
  every role the company posts, which it will never send.
*/
is(
  'a company plus another filter is still a search',
  followedCompany(toCanonicalQuery({ ...NONE, companySlug: 'alrwad-482913', tracks: ['primary'] })),
  null,
);
is('a company parameter with nothing in it', followedCompany('company='), null);
is('two companies', followedCompany('company=a-1&company=b-2'), null);

console.log('\n— the filter value cannot be anything but a slug');
is('an ordinary slug', companySlugOrNull('alrwad-482913'), 'alrwad-482913');
is('one somebody typed in capitals', companySlugOrNull('AlRwad-482913'), 'alrwad-482913');
is('with the whitespace a copy-paste leaves', companySlugOrNull('  alrwad-482913  '), 'alrwad-482913');
is('an Arabic name rather than a slug', companySlugOrNull('الرواد'), null);
// PostgREST's filter grammar reads commas, parentheses and dots as syntax.
// `.eq` encodes its operand so none of this could reach it anyway — this is
// the second lock, not the first.
is('a PostgREST filter fragment', companySlugOrNull('a-1,slug.eq.b-2'), null);
is('a wildcard', companySlugOrNull('%'), null);
is('an empty string', companySlugOrNull(''), null);
is('a repeated parameter', companySlugOrNull(['a-1', 'b-2']), null);
is('nothing at all', companySlugOrNull(undefined), null);
is('something longer than any slug this app mints', companySlugOrNull('a'.repeat(81)), null);

console.log('\n— the pay, commission and date filters are part of what is saved');
is(
  'two orders of the same commission types are one search',
  toCanonicalQuery({ ...NONE, commissionTypes: ['split', 'percentage'] }),
  toCanonicalQuery({ ...NONE, commissionTypes: ['percentage', 'split'] }),
);
is(
  'each is written under the key the board reads',
  toCanonicalQuery({ ...NONE, minSalary: 10000, commissionTypes: ['percentage'], postedWithin: 7 }),
  'comm=percentage&pay=10000&posted=7',
);
is('a minimum salary alone is worth saving', hasFilters({ ...NONE, minSalary: 5000 }), true);

console.log('\n— a saved query keeps every value of a multi-select');
/*
  The save action and the weekly digest both turn the stored string back into
  the parser's input. They used Object.fromEntries, which keeps the last value
  of a repeated key, so a search for two tracks was saved — and mailed — as a
  search for one.
*/
is(
  'two tracks and two districts survive the trip',
  queryParams('district=maadi&district=new-cairo&track=primary&track=resale'),
  { district: ['maadi', 'new-cairo'], track: ['primary', 'resale'] },
);
is('a key that appears once stays a string', queryParams('q=مبيعات&salary=yes'), { q: 'مبيعات', salary: 'yes' });
is('an empty query is no parameters', queryParams(''), {});
is(
  'and the canonical form reads back to itself',
  toCanonicalQuery({ ...NONE, tracks: ['primary', 'resale'], commissionTypes: ['split', 'none'] }),
  new URLSearchParams(
    Object.entries(queryParams('comm=none&comm=split&track=primary&track=resale'))
      .flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map((v) => [key, v])),
  ).toString(),
);

console.log('\n— the stand-in filter set still matches the real one');
{
  /*
    A test that passes for the wrong reason is worse than none.

    Everything above canonicalises a hand-written NONE. If the filter model
    grows a key that NONE does not carry, `toCanonicalQuery` would read
    undefined for it, emit nothing, and every assertion above would still be
    green while saying nothing about the real thing. The model now lives in
    job-filters.ts, which imports nothing server-side, so the real
    EMPTY_FILTERS is compared whole — every key and every default.
  */
  const { register } = await import('node:module');
  register('../supabase/tests/alias-hooks.mjs', import.meta.url);
  const { EMPTY_FILTERS } = await import('../src/lib/job-filters.ts');

  is('every key of EMPTY_FILTERS', Object.keys(EMPTY_FILTERS).sort(), Object.keys(NONE).sort());
  is('and every default', EMPTY_FILTERS, NONE);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
