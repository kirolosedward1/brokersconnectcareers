/**
 * Verifies a restored database against the manifest its backup was taken with.
 *
 *   TARGET_DATABASE_URL='postgresql://...' node scripts/dr/verify.mjs backups/<ts>
 *
 * A restore is not trusted until this passes. It checks, in order:
 *
 *   1. schema   every column, constraint, index, RLS switch, policy, function,
 *               trigger, enum and bucket matches the backup's fingerprint
 *   2. data     every table has the same row count and content hash
 *   3. keys     every foreign key and CHECK constraint holds on every row. The
 *               restore loads with triggers off, which also skips foreign-key
 *               checks, so this is the only thing that proves them
 *   4. access   RLS and the guard triggers still behave, exercised as real
 *               users from the restored data, inside a transaction that is
 *               rolled back
 *
 * Read-only apart from that rolled-back transaction, so it is safe against
 * production. There, the schema, keys and access sections are a health check;
 * the data section will differ by whatever was written since the backup.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
const url = process.env.TARGET_DATABASE_URL;
if (!dir || !url) {
  console.error('Usage: TARGET_DATABASE_URL=... node scripts/dr/verify.mjs <backup-dir>');
  process.exit(2);
}

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes('supabase.') ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function readTsv(file) {
  return new Map(
    readFileSync(join(dir, file), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t');
        return [parts.slice(0, -1).join('\t'), parts.at(-1)];
      }),
  );
}

function compare(label, expected, actual) {
  const missing = [...expected.keys()].filter((k) => !actual.has(k));
  const extra = [...actual.keys()].filter((k) => !expected.has(k));
  const changed = [...expected.keys()].filter((k) => actual.has(k) && actual.get(k) !== expected.get(k));
  const detail = [
    missing.length && `missing ${missing.slice(0, 5).join(', ')}`,
    extra.length && `extra ${extra.slice(0, 5).join(', ')}`,
    changed.length && `different ${changed.slice(0, 5).join(', ')}`,
  ]
    .filter(Boolean)
    .join('; ');
  check(`${label}: ${expected.size} expected, ${actual.size} found`, !detail, detail);
}

// ---------------------------------------------------------------------------
console.log('\n— schema');
{
  const { rows } = await client.query(readFileSync(join(HERE, 'fingerprint.sql'), 'utf8'));
  compare('objects', readTsv('fingerprint.tsv'), new Map(rows.map((r) => [`${r.kind}\t${r.name}`, r.hash])));
}

// ---------------------------------------------------------------------------
console.log('\n— data');
{
  const result = await client.query(readFileSync(join(HERE, 'table-hashes.sql'), 'utf8'));
  // Multi-statement: the last result set is the select.
  const rows = (Array.isArray(result) ? result.at(-1) : result).rows;
  const expected = readTsv('tables.tsv');
  compare('tables', expected, new Map(rows.map((r) => [`${r.name}\t${r.n}`, r.hash])));
  const total = rows.reduce((sum, r) => sum + Number(r.n), 0);
  console.log(`        ${rows.length} tables, ${total} rows`);
}

// ---------------------------------------------------------------------------
console.log('\n— keys and constraints');
{
  const { rows: fks } = await client.query(`
    select c.conname, c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent,
           array(select quote_ident(attname) from unnest(c.conkey) with ordinality k(n, i)
                  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i) as cols,
           array(select quote_ident(attname) from unnest(c.confkey) with ordinality k(n, i)
                  join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.i) as pcols
      from pg_constraint c
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace`);
  let orphans = [];
  for (const fk of fks) {
    const notNull = fk.cols.map((c) => `c.${c} is not null`).join(' and ');
    const join_ = fk.cols.map((c, i) => `p.${fk.pcols[i]} = c.${c}`).join(' and ');
    const { rows } = await client.query(
      `select count(*)::int n from ${fk.child} c where ${notNull}
         and not exists (select 1 from ${fk.parent} p where ${join_})`,
    );
    if (rows[0].n > 0) orphans.push(`${fk.conname} (${rows[0].n})`);
  }
  check(`${fks.length} foreign keys hold`, orphans.length === 0, orphans.join(', '));

  const { rows: checks } = await client.query(`
    select conname, conrelid::regclass::text as rel, pg_get_constraintdef(oid) as def
      from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace`);
  const broken = [];
  for (const c of checks) {
    const expr = c.def.replace(/^CHECK \(/, '(').replace(/\s+NOT VALID$/, '');
    const { rows } = await client.query(`select count(*)::int n from ${c.rel} where not ${expr}`);
    if (rows[0].n > 0) broken.push(`${c.conname} (${rows[0].n})`);
  }
  check(`${checks.length} CHECK constraints hold`, broken.length === 0, broken.join(', '));
}

// ---------------------------------------------------------------------------
console.log('\n— access (rolled back)');
{
  async function as(userId, sql, params = []) {
    await client.query('savepoint probe');
    try {
      await client.query('set local role authenticated');
      const claims = JSON.stringify(userId ? { role: 'authenticated', sub: userId } : { role: 'anon' });
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
      const { rows } = await client.query(sql, params);
      await client.query('release savepoint probe');
      await client.query('reset role');
      return { ok: true, rows };
    } catch (error) {
      await client.query('rollback to savepoint probe');
      await client.query('reset role');
      return { ok: false, error: error.message, rows: [] };
    }
  }

  await client.query('begin');
  try {
    const { rows: picks } = await client.query(`
      select a.id, a.candidate_id, a.status, m.user_id as employer,
             (select count(*) from applications) as total
        from applications a
        join jobs j on j.id = a.job_id
        join company_members m on m.company_id = j.company_id
       limit 1`);

    if (!picks.length) {
      console.log('  SKIP  no applications in this database to exercise RLS with');
    } else {
      const p = picks[0];

      const mine = await as(p.candidate_id, 'select candidate_id from applications');
      check(
        'a candidate sees only their own applications',
        mine.ok && mine.rows.length > 0 && mine.rows.every((r) => r.candidate_id === p.candidate_id),
        mine.error,
      );

      // Zero rows or a permission error are both a pass.
      // Claims set with set_config(..., true) outlive a released savepoint, so
      // clear the previous probe's identity explicitly.
      await client.query('savepoint anon');
      await client.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true),
                                 set_config('request.jwt.claim.sub', '', true)`);
      await client.query('set local role anon');
      const anon = await client
        .query('select count(*)::int n from applications')
        .then((r) => r.rows[0].n === 0, () => true);
      await client.query('rollback to savepoint anon');
      await client.query('reset role');
      check('an anonymous visitor sees no applications', anon);

      const escalate = await as(p.candidate_id, `update profiles set role = 'admin' where id = $1`, [
        p.candidate_id,
      ]);
      check('a user cannot make themselves admin (guard trigger)', !escalate.ok, 'update was accepted');

      const next = p.status === 'shortlisted' ? 'interview' : 'shortlisted';
      const before = await client.query('select count(*)::int n from notifications where user_id = $1', [
        p.candidate_id,
      ]);
      const move = await as(p.employer, 'update applications set status = $1 where id = $2 returning id', [
        next,
        p.id,
      ]);
      const after = await client.query('select count(*)::int n from notifications where user_id = $1', [
        p.candidate_id,
      ]);
      check('the employer can move an applicant', move.ok && move.rows.length === 1, move.error);
      check(
        'moving an applicant notifies the candidate (trigger)',
        after.rows[0].n === before.rows[0].n + 1,
        `${before.rows[0].n} → ${after.rows[0].n}`,
      );
    }
  } finally {
    await client.query('rollback');
  }
}

await client.end();
console.log(failures ? `\n${failures} check(s) FAILED — do not trust this restore.` : '\nrestore verified.');
process.exit(failures ? 1 : 0);
