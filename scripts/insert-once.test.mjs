/**
 * A create pressed again after its answer was lost: found, not written twice.
 *
 *   node --experimental-strip-types scripts/insert-once.test.mjs
 *
 * The CV's three sections and the applicant notes send a key the form made
 * once (src/lib/actions/idempotency.ts, migration 357). These are the rules
 * that turn the database's refusal of a second insert into the row the first
 * one made — and that keep the code working before 350 is applied.
 */
const { insertOnce, missingColumn } = await import('../src/lib/actions/idempotency.ts');

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

const KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ok = (data) => Promise.resolve({ data, error: null });
const refused = (code, message = code) => Promise.resolve({ data: null, error: { code, message } });

/** A table: what each insert answers in turn, and what the lookup by key finds. */
function table({ inserts, found = null }) {
  const sent = [];
  let looked = 0;
  return {
    sent,
    looked: () => looked,
    insert: (withKey) => {
      sent.push(withKey);
      return inserts[sent.length - 1]();
    },
    already: () => {
      looked += 1;
      return ok(found);
    },
  };
}

console.log('— the first attempt');
{
  const t = table({ inserts: [() => ok({ id: 'new' })] });
  is('goes in with its key', await insertOnce(KEY, t.insert, t.already), { data: { id: 'new' }, error: null });
  is('sent once, with the key, and nothing looked up', [t.sent, t.looked()], [[true], 0]);
}

console.log('\n— the retry of an attempt that did go in');
{
  const t = table({
    inserts: [() => refused('23505', 'duplicate key value violates unique constraint "agent_experience_idempotency_key_idx"')],
    found: { id: 'first' },
  });
  is('answers with the row the first one made', await insertOnce(KEY, t.insert, t.already), {
    data: { id: 'first' },
    error: null,
  });
}
{
  // The CV's section cap is checked before the index: the retry of the entry
  // that filled the section is refused with `cap`, and is still that entry.
  const t = table({ inserts: [() => refused('P0001', 'cv_section_cap')], found: { id: 'first' } });
  is('found even when the cap refuses it first', await insertOnce(KEY, t.insert, t.already), {
    data: { id: 'first' },
    error: null,
  });
}

console.log('\n— a refusal that is not a retry');
{
  const t = table({ inserts: [() => refused('P0001', 'cv_section_cap')] });
  is('is passed on as it was', await insertOnce(KEY, t.insert, t.already), {
    data: null,
    error: { code: 'P0001', message: 'cv_section_cap' },
  });
}
{
  const t = table({ inserts: [() => refused('42501', 'new row violates row-level security policy')] });
  is('a forged owner stays refused', (await insertOnce(KEY, t.insert, t.already)).error?.code, '42501');
}

console.log('\n— before migration 357 is applied');
for (const code of ['PGRST204', '42703']) {
  const t = table({ inserts: [() => refused(code, "Could not find the 'idempotency_key' column"), () => ok({ id: 'new' })] });
  is(`${code}: written without the key`, await insertOnce(KEY, t.insert, t.already), { data: { id: 'new' }, error: null });
  is(`${code}: once with it, once without, nothing looked up`, [t.sent, t.looked()], [[true, false], 0]);
}

console.log('\n— a caller with no key (an older app)');
{
  const t = table({ inserts: [() => ok({ id: 'new' })] });
  await insertOnce(undefined, t.insert, t.already);
  is('writes as before: no key, no lookup', [t.sent, t.looked()], [[false], 0]);
}

console.log('\n— missingColumn');
is('a unique violation is not one', missingColumn({ code: '23505', message: '' }), false);
is('no error is not one', missingColumn(null), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
