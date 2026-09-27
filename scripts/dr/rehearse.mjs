/**
 * End-to-end rehearsal of the database backup and restore, on a throwaway
 * Postgres server. Never touches Supabase.
 *
 *   REHEARSAL_URL='postgresql://postgres@127.0.0.1:5439/postgres' node scripts/dr/rehearse.mjs
 *
 * REHEARSAL_URL must be a disposable server this script may create and drop
 * databases on. It builds `dr_source` the way production was built (migrations,
 * taxonomies, demo accounts and listings), backs it up with db-backup.sh,
 * restores into an empty `dr_target` with db-restore.sh, and verifies with
 * verify.mjs. Then it rehearses the commonest real incident: rows deleted by
 * mistake, recovered from the backup's full.dump without a full restore.
 *
 * The server's major version must match its pg_dump, as with production.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const admin = process.env.REHEARSAL_URL;
if (!admin) {
  console.error('Set REHEARSAL_URL to a disposable Postgres server.');
  process.exit(2);
}
if (admin.includes('supabase.')) {
  console.error('REHEARSAL_URL points at Supabase. The rehearsal only runs on a throwaway server.');
  process.exit(2);
}

const dbUrl = (name) => {
  const u = new URL(admin);
  u.pathname = `/${name}`;
  return u.toString();
};
const SOURCE = dbUrl('dr_source');
const TARGET = dbUrl('dr_target');
const SCRATCH = dbUrl('dr_scratch');

async function sql(url, text, params) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await c.query(text, params);
  } finally {
    await c.end();
  }
}

function step(title) {
  console.log(`\n=== ${title}`);
}

function run(cmd, args, env) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`\n${cmd} ${args.join(' ')} failed (${r.status})`);
    process.exit(1);
  }
}

step('fresh databases');
for (const name of ['dr_source', 'dr_target', 'dr_scratch']) {
  await sql(admin, `drop database if exists ${name} with (force)`);
  await sql(admin, `create database ${name}`);
}
const stub = readFileSync(join(HERE, 'supabase-stub.sql'), 'utf8');
for (const url of [SOURCE, TARGET, SCRATCH]) await sql(url, stub);
console.log('  dr_source, dr_target, dr_scratch created with the Supabase stub');

step('source: built the way production was');
run('node', [join(ROOT, 'scripts', 'db-push.mjs')], { DATABASE_URL: SOURCE });
{
  const keys = [
    'employer1', 'employer2', 'employer3', 'employer4', 'employer5', 'employer6', 'employer7',
    'candidate1', 'candidate2', 'candidate3', 'candidate4', 'candidate5', 'candidate6', 'candidate7',
    'admin',
  ];
  const ids = Object.fromEntries(
    keys.map((k, i) => [k, `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]),
  );
  const c = new pg.Client({ connectionString: SOURCE });
  await c.connect();
  await c.query('begin');
  await c.query(
    `insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
     select value::uuid, 'authenticated', 'authenticated', key || '@demo.test',
            '$2a$10$rehearsalhashrehearsalhashrehearsalhashrehearsalhash', now()
       from jsonb_each_text($1::jsonb)`,
    [JSON.stringify(ids)],
  );
  await c.query(`select set_config('demo.users', $1, false)`, [JSON.stringify(ids)]);
  await c.query(readFileSync(join(ROOT, 'supabase', 'seed-demo.sql'), 'utf8'));
  await c.query('commit');
  const { rows } = await c.query(`
    select (select count(*) from auth.users) users, (select count(*) from companies) companies,
           (select count(*) from jobs) jobs, (select count(*) from applications) applications,
           (select count(*) from notifications) notifications`);
  await c.end();
  console.log('  demo data loaded', rows[0]);
}

const work = mkdtempSync(join(tmpdir(), 'dr-rehearsal-'));
const backup = join(work, 'backup');

step('backup (scripts/dr/db-backup.sh)');
run('bash', [join(HERE, 'db-backup.sh'), backup], { DATABASE_URL: SOURCE, DR_ALLOW_PLAINTEXT: '1' });

step('restore into an empty database (scripts/dr/db-restore.sh)');
run('bash', [join(HERE, 'db-restore.sh'), backup], { TARGET_DATABASE_URL: TARGET });

step('refuses production');
{
  const r = spawnSync('bash', [join(HERE, 'db-restore.sh'), backup], {
    env: { ...process.env, TARGET_DATABASE_URL: 'postgresql://x@db.hiwdhicwsohbipxzazmb.supabase.co/postgres' },
    encoding: 'utf8',
  });
  const refused = r.status !== 0 && /PRODUCTION/.test(r.stderr);
  console.log(`  ${refused ? 'PASS' : 'FAIL'}  restore script refuses the production ref`);
  if (!refused) process.exit(1);
}

step('incident: applications deleted by mistake, recovered from full.dump');
{
  // Deleting an application cascades to its events and notes, so recovering
  // the one table the operator named would quietly lose its history. The
  // runbook's first question is what the delete cascaded to.
  const TABLES = ['applications', 'application_events', 'application_notes'];
  const counts = async (url) =>
    (await sql(url, `select ${TABLES.map((t) => `(select count(*)::int from public.${t}) ${t}`).join(', ')}`))
      .rows[0];

  const before = await counts(SOURCE);
  const incidentStart = (await sql(SOURCE, 'select clock_timestamp() t')).rows[0].t;
  await sql(SOURCE, `delete from applications`);
  const damaged = await counts(SOURCE);
  console.log('  simulated operator mistake:', JSON.stringify(before), '→', JSON.stringify(damaged));

  // 1. Restore the affected tables into scratch, never into the damaged database.
  spawnSync('pg_restore', ['--dbname', SCRATCH, '--no-owner', '--schema-only', '--schema=public',
    join(backup, 'full.dump')], { stdio: 'ignore' });
  execFileSync('pg_restore', ['--dbname', SCRATCH, '--no-owner', '--data-only', '--disable-triggers',
    ...TABLES.flatMap((t) => ['--table', t]), join(backup, 'full.dump')]);
  console.log('  scratch now holds the backup copy:', JSON.stringify(await counts(SCRATCH)));

  // 2. Copy back only the missing rows, parents first, with triggers off so
  //    the rate limit and notifications do not fire for replayed history.
  //    Drop the dump's setval lines: scratch's sequences were never advanced,
  //    and replaying them would rewind the live sequences to 1 so the next
  //    insert collides with a row that already exists.
  const dump = execFileSync('pg_dump', [SCRATCH, '--data-only', '--inserts', '--on-conflict-do-nothing',
    ...TABLES.flatMap((t) => ['--table', `public.${t}`])])
    .toString()
    .split('\n')
    .filter((line) => !line.startsWith('SELECT pg_catalog.setval'))
    .join('\n');
  const file = join(work, 'copy-back.sql');
  writeFileSync(file, dump);
  const seqBefore = (await sql(SOURCE, `select last_value from application_events_id_seq`)).rows[0].last_value;
  run('psql', [SOURCE, '-X', '-q', '-o', '/dev/null', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', file], {
    PGOPTIONS: '-c session_replication_role=replica',
  });
  const seqAfter = (await sql(SOURCE, `select last_value from application_events_id_seq`)).rows[0].last_value;
  const seqOk = seqAfter === seqBefore;
  console.log(`  ${seqOk ? 'PASS' : 'FAIL'}  live sequence untouched (${seqBefore} → ${seqAfter})`);
  if (!seqOk) process.exit(1);

  const after = await counts(SOURCE);
  const ok = TABLES.every((t) => after[t] === before[t]);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  recovered:`, JSON.stringify(after));
  if (!ok) process.exit(1);

  // 3. Undo the incident's side effects. The delete fired the withdrawal
  //    trigger, which notified every affected employer about applications
  //    nobody withdrew. In production those rows may also have queued email.
  const side = await sql(SOURCE, `delete from notifications where created_at >= $1 returning kind`, [incidentStart]);
  console.log(`  removed ${side.rowCount} notification(s) the mistake generated (${[...new Set(side.rows.map((r) => r.kind))].join(', ')})`);

  // 4. The whole database must still verify against the backup.
  run('node', [join(HERE, 'verify.mjs'), backup], { TARGET_DATABASE_URL: SOURCE });
}

rmSync(work, { recursive: true, force: true });
for (const name of ['dr_source', 'dr_target', 'dr_scratch']) {
  await sql(admin, `drop database if exists ${name} with (force)`);
}
console.log('\nrehearsal passed: backup, full restore, verification and single-table recovery all work.');
