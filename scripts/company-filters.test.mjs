/**
 * The directory's page links keep the view they page through.
 *
 *   node --experimental-strip-types scripts/company-filters.test.mjs
 *
 * The pager kept the search and the page and nothing else, so page 2 of
 * verified companies in New Cairo was page 2 of the whole directory.
 */
const { companiesHref } = await import('../src/lib/company-filters.ts');

let pass = 0;
let fail = 0;
function is(label, got, want) {
  if (got === want) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

is('the whole directory', companiesHref({}), '/companies');
is('page 1 carries no page', companiesHref({ q: 'نايل', page: 1 }), '/companies?q=%D9%86%D8%A7%D9%8A%D9%84');
is(
  'page 2 of verified companies in New Cairo stays in New Cairo, verified',
  companiesHref({ district: 'new-cairo', verified: true, page: 2 }),
  '/companies?district=new-cairo&verified=1&page=2',
);
is(
  'with a search as well',
  companiesHref({ q: 'nile', district: 'sheikh-zayed', verified: true, page: 3 }),
  '/companies?q=nile&district=sheikh-zayed&verified=1&page=3',
);
is('an unknown district is not carried', companiesHref({ district: null, page: 2 }), '/companies?page=2');
is('verified off is not carried', companiesHref({ verified: false, page: 2 }), '/companies?page=2');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
