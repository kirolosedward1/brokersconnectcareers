/**
 * Applies supabase/migrations/*.sql and supabase/seed.sql over a plain Postgres
 * connection.
 *
 * The Supabase CLI is the normal way to do this, but it needs Docker for local
 * work and a linked project otherwise. This script needs neither — just the
 * connection string from Project Settings → Database → Connection string → URI.
 *
 *   DATABASE_URL='postgresql://...' node scripts/db-push.mjs
 *   DATABASE_URL='postgresql://...' node scripts/db-push.mjs --seed-only
 *   DATABASE_URL='postgresql://...' node scripts/db-push.mjs --reset
 *
 * This applies the schema and the taxonomies only. Demo accounts and sample
 * listings come from scripts/seed-demo.mjs, which needs the Auth admin API.
 *
 * Each migration runs in its own transaction, so a failure leaves the database
 * on the last migration that fully succeeded rather than half-applied.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const SEED = join(ROOT, 'supabase', 'seed.sql');

const args = new Set(process.argv.slice(2));
const seedOnly = args.has('--seed-only');
const reset = args.has('--reset');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'Set DATABASE_URL first.\n\n' +
      '  Supabase → Project Settings → Database → Connection string → URI\n' +
      '  (use the direct connection, not the transaction pooler — the pooler\n' +
      '  rejects the multi-statement DDL these migrations contain)\n\n' +
      "  DATABASE_URL='postgresql://postgres:PASSWORD@db.REF.supabase.co:5432/postgres' \\\n" +
      '    node scripts/db-push.mjs',
  );
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  // Supabase terminates TLS with a certificate this client has no root for;
  // the connection is still encrypted.
  ssl: connectionString.includes('supabase.') ? { rejectUnauthorized: false } : undefined,
});

async function apply(label, sql) {
  process.stdout.write(`  ${label} … `);
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    console.log('ok');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    console.log('FAILED');
    console.error(`\n${error.message}`);
    if (error.hint) console.error(`hint: ${error.hint}`);
    if (error.position) console.error(`at character ${error.position}`);
    await client.end();
    process.exit(1);
  }
}

await client.connect();
const { rows } = await client.query('select current_database() as db, version() as v');
console.log(`connected to ${rows[0].db} — ${rows[0].v.split(',')[0]}\n`);

if (reset) {
  console.log('resetting public schema');
  await apply(
    'drop and recreate public',
    `
    drop schema if exists public cascade;
    create schema public;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on functions to anon, authenticated, service_role;
    `,
  );
}

if (!seedOnly) {
  console.log('migrations');
  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (!file.endsWith('.sql')) continue;
    await apply(file, readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  console.log();
}

console.log('seed');
await apply('seed.sql', readFileSync(SEED, 'utf8'));

// Supabase's default grants do not cover tables created after the fact.
console.log('\ngrants');
await apply(
  'api roles',
  `
  grant usage on schema public to anon, authenticated, service_role;
  grant select on all tables in schema public to anon;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant all on all tables in schema public to service_role;
  grant usage, select on all sequences in schema public to anon, authenticated, service_role;
  `,
);

const counts = await client.query(`
  select
    (select count(*) from governorates) as governorates,
    (select count(*) from districts) as districts,
    (select count(*) from developers) as developers,
    (select count(*) from jobs where status = 'active') as active_jobs
`);
console.log('\n', counts.rows[0]);

await client.end();

console.log('\ndone');
if (Number(counts.rows[0].active_jobs) === 0) {
  console.log(
    '\nThe board has no listings yet. For demo accounts and sample jobs:\n' +
      '  node scripts/seed-demo.mjs',
  );
}
