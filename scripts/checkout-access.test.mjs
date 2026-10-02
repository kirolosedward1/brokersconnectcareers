/**
 * Who may start a checkout, and what a failed read says.
 *
 *   node --experimental-strip-types scripts/checkout-access.test.mjs
 *
 * The buy button tells somebody refused as forbidden or without a company who
 * may buy, and that trying again changes nothing (buy-pack-button.tsx). That
 * is only true of an answer: a read that failed — a timeout, a blip — has to
 * come back as `failed`, "try again", or the company's own approved admin is
 * told they may not buy.
 */
const { checkoutAccess } = await import('../src/lib/checkout-access.ts');

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

const COMPANY = { id: 'c1', name_ar: 'نايل' };
const ok = (data) => Promise.resolve({ data, error: null });
const broken = () => Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });

/** The approved admin of a company, every read answering; `change` swaps one read. */
const reads = (change = {}) => ({
  myCompanyId: () => ok('c1'),
  company: (id) => ok(id === 'c1' ? COMPANY : null),
  isCompanyAdmin: (id) => ok(id === 'c1'),
  standing: () => ok({ approval_status: 'approved' }),
  ...change,
});

console.log('— answers');
is('the approved admin may buy, for their company', await checkoutAccess(reads()), { ok: true, company: COMPANY });
is('no company to buy for', await checkoutAccess(reads({ myCompanyId: () => ok(null) })), { ok: false, error: 'no_company' });
is('a company the session cannot see', await checkoutAccess(reads({ company: () => ok(null) })), {
  ok: false,
  error: 'no_company',
});
is('a member who is not its admin', await checkoutAccess(reads({ isCompanyAdmin: () => ok(false) })), {
  ok: false,
  error: 'forbidden',
});
is('an account not approved yet', await checkoutAccess(reads({ standing: () => ok({ approval_status: 'pending' }) })), {
  ok: false,
  error: 'forbidden',
});
is('no profile at all', await checkoutAccess(reads({ standing: () => ok(null) })), { ok: false, error: 'forbidden' });

console.log('\n— a read that failed is "try again", whichever it was');
for (const read of ['myCompanyId', 'company', 'isCompanyAdmin', 'standing']) {
  is(`${read} failing`, await checkoutAccess(reads({ [read]: broken })), { ok: false, error: 'failed' });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
