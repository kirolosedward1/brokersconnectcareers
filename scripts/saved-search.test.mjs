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

const { followQuery, followedCompany, toCanonicalQuery, hasFilters } = await import(
  '../src/lib/saved-search.ts'
);
const { companySlugOrNull } = await import('../src/lib/search/company-slug.ts');

/**
 * The empty filter set, spelled out here rather than imported.
 *
 * EMPTY_FILTERS lives in queries/jobs.ts, which pulls in the server client and
 * `server-only` and therefore cannot be imported into a node script. Written
 * out instead — and if a filter is ever added to the model without appearing
 * here, the round-trip assertions below stop proving what they claim, so the
 * last test in this file checks the two agree.
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
  companySlug: null,
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

console.log('\n— the stand-in filter set still matches the real one');
{
  /*
    A test that passes for the wrong reason is worse than none.

    Everything above canonicalises a hand-written NONE. If the filter model
    grows a key that NONE does not carry, `toCanonicalQuery` would read
    undefined for it, emit nothing, and every assertion above would still be
    green while saying nothing about the real thing. So read the real
    EMPTY_FILTERS out of the source — it cannot be imported, but it can be
    looked at.
  */
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/lib/queries/jobs.ts', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('export const EMPTY_FILTERS'));
  const keys = [...block.slice(0, block.indexOf('};')).matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);

  is('every key of EMPTY_FILTERS', keys.sort(), Object.keys(NONE).sort());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
