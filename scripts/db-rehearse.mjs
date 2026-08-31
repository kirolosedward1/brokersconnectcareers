/**
 * Rehearses the real setup path against a throwaway Postgres.
 *
 *   pnpm db:rehearse
 *
 * Boots PGlite behind a TCP socket speaking the Postgres wire protocol, then
 * runs scripts/db-push.mjs and the SQL half of the demo seed against it exactly
 * as they will run against Supabase — same `pg` client, same multi-statement
 * DDL, same transaction boundaries.
 *
 * This is not the same test as `pnpm test:db`, which loads the SQL in-process.
 * This one exercises the scripts. It is what would have caught the seed calling
 * `gen_salt()` without the `extensions` schema on its search_path.
 *
 * The one thing it cannot cover is user creation: that goes through the GoTrue
 * admin API, which has no local stand-in.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import pg from 'pg';
import { ROOT } from './env.mjs';

const PORT = 5433;
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;

// The Supabase-managed pieces PGlite has no idea about.
const PRELUDE = `
do $do$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $do$;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

create table auth.users (
  id uuid primary key, instance_id uuid, aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz
);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$fn$;

create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$ select string_to_array(name,'/'); $fn$;
`;

const db = new PGlite({ extensions: { pgcrypto, unaccent } });
await db.exec(PRELUDE);

const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
await server.start();
console.log(`rehearsal database listening on 127.0.0.1:${PORT}\n`);

function run(script) {
  return new Promise((resolve) => {
    const child = spawn('node', [join(ROOT, 'scripts', script)], {
      env: { ...process.env, DATABASE_URL: URL },
      stdio: 'inherit',
    });
    child.on('exit', resolve);
  });
}

const pushCode = await run('db-push.mjs');
if (pushCode !== 0) {
  console.error('\ndb-push.mjs failed — that is the bug, not the rehearsal.');
  await server.stop();
  process.exit(1);
}

// The demo seed's SQL half, driven the way seed-demo.mjs drives it.
console.log('\ndemo data (SQL half)');
const client = new pg.Client({ connectionString: URL });
await client.connect();

const ids = Object.fromEntries(
  [
    'employer1', 'employer2', 'employer3', 'employer4', 'employer5', 'employer6', 'employer7',
    'candidate1', 'candidate2', 'candidate3', 'candidate4', 'candidate5', 'candidate6', 'candidate7',
    'admin',
  ].map((key, index) => [key, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]),
);

try {
  await client.query('begin');
  await client.query(
    `insert into auth.users (id, aud, role, email, email_confirmed_at)
     select value::uuid, 'authenticated', 'authenticated', key || '@demo.test', now()
     from jsonb_each_text($1::jsonb)`,
    [JSON.stringify(ids)],
  );
  await client.query(`select set_config('demo.users', $1, false)`, [JSON.stringify(ids)]);
  await client.query(readFileSync(join(ROOT, 'supabase', 'seed-demo.sql'), 'utf8'));
  await client.query('commit');
  console.log('  seed-demo.sql … ok');
} catch (error) {
  await client.query('rollback').catch(() => {});
  console.error(`  seed-demo.sql … FAILED\n\n${error.message}`);
  if (error.hint) console.error(`hint: ${error.hint}`);
  await client.end();
  await server.stop();
  process.exit(1);
}

const { rows } = await client.query(`
  select (select count(*) from companies) companies,
         (select count(*) from jobs where status = 'active') active_jobs,
         (select count(*) from agent_profiles) agents,
         (select count(*) from applications) applications
`);
console.log('\n', rows[0]);

await client.end();
await server.stop();
console.log('\nrehearsal passed — the same commands will work against Supabase.');
process.exit(0);
