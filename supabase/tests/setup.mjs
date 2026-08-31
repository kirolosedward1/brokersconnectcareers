/**
 * Boots a throwaway Postgres in-process (PGlite) and applies the real
 * migrations and seed to it, so the policies can be exercised without Docker,
 * a Supabase project, or a network.
 *
 * PGlite is plain Postgres — it just does not ship Supabase's `auth` and
 * `storage` schemas or its API roles, so those are stubbed to the shape the
 * migrations actually depend on. pgcrypto and unaccent are loaded for real, so
 * the `create extension` lines and the seed's crypt()/gen_salt() calls are
 * exercised rather than faked. Everything below that line is the production
 * SQL, verbatim.
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPABASE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const PRELUDE = `
-- Roles Supabase provisions for the API.
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

create table storage.buckets (
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $fn$ select string_to_array(name, '/'); $fn$;
`;

const GRANTS = `
grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
`;

/**
 * Stand-ins for the accounts scripts/seed-demo.mjs creates through the Auth
 * admin API. Ids are fixed so the assertions below can name them.
 */
const DEMO_KEYS = [
  ['employer1', '11111111-1111-1111-1111-111111111111', 'employer1@demo.test'],
  ['employer2', '22222222-2222-2222-2222-222222222222', 'employer2@demo.test'],
  ['employer3', '33333333-0000-0000-0000-000000000003', 'employer3@demo.test'],
  ['employer4', '33333333-0000-0000-0000-000000000004', 'employer4@demo.test'],
  ['employer5', '33333333-0000-0000-0000-000000000005', 'employer5@demo.test'],
  ['employer6', '33333333-0000-0000-0000-000000000006', 'employer6@demo.test'],
  ['employer7', '33333333-0000-0000-0000-000000000007', 'employer7@demo.test'],
  ['candidate1', '33333333-3333-3333-3333-333333333333', 'candidate1@demo.test'],
  ['candidate2', '44444444-0000-0000-0000-000000000002', 'candidate2@demo.test'],
  ['candidate3', '44444444-0000-0000-0000-000000000003', 'candidate3@demo.test'],
  ['candidate4', '44444444-0000-0000-0000-000000000004', 'candidate4@demo.test'],
  ['candidate5', '44444444-0000-0000-0000-000000000005', 'candidate5@demo.test'],
  ['candidate6', '44444444-0000-0000-0000-000000000006', 'candidate6@demo.test'],
  ['candidate7', '44444444-0000-0000-0000-000000000007', 'candidate7@demo.test'],
  ['admin', '44444444-4444-4444-4444-444444444444', 'admin@demo.test'],
];

const DEMO_USERS = `
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
values
${DEMO_KEYS.map(
  ([, id, email]) =>
    `  ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email}', now(), now(), now())`,
).join(',\n')};

select set_config('demo.users', '${JSON.stringify(
  Object.fromEntries(DEMO_KEYS.map(([key, id]) => [key, id])),
)}', false);
`;

export async function createTestDb({ seed = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto, unaccent } });
  await db.exec(PRELUDE);

  const migrations = join(SUPABASE_DIR, 'migrations');
  for (const file of readdirSync(migrations).sort()) {
    if (!file.endsWith('.sql')) continue;
    await db.exec(readFileSync(join(migrations, file), 'utf8'));
  }

  if (seed) {
    await db.exec(readFileSync(join(SUPABASE_DIR, 'seed.sql'), 'utf8'));
    // The real auth users come from the Auth admin API in production; here the
    // stubbed schema lets them be inserted directly.
    await db.exec(DEMO_USERS);
    await db.exec(readFileSync(join(SUPABASE_DIR, 'seed-demo.sql'), 'utf8'));
  }
  await db.exec(GRANTS);

  return db;
}

/**
 * Runs `sql` as a given user with RLS enforced, then rolls back — so tests can
 * probe destructive statements without ordering constraints between them.
 */
export function runner(db) {
  return async function as(userId, sql, role = 'authenticated') {
    await db.exec('begin');
    try {
      await db.exec(`set local role ${role};`);
      if (userId) {
        await db.exec(`set local request.jwt.claim.sub = '${userId}';`);
        await db.exec(`set local request.jwt.claims = '{"role":"${role}","sub":"${userId}"}';`);
      } else {
        await db.exec(`set local request.jwt.claims = '{"role":"${role}"}';`);
      }
      const result = await db.query(sql);
      await db.exec('rollback');
      return { ok: true, rows: result.rows };
    } catch (error) {
      await db.exec('rollback');
      return { ok: false, error: error.message, hint: error.hint, rows: [] };
    }
  };
}

export function reporter() {
  const state = { pass: 0, fail: 0 };

  return {
    section(title) {
      console.log(`\n— ${title}`);
    },
    check(label, condition, detail = '') {
      if (condition) {
        state.pass += 1;
        console.log(`  PASS  ${label}`);
      } else {
        state.fail += 1;
        console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
      }
    },
    finish() {
      console.log(`\n${state.pass} passed, ${state.fail} failed`);
      return state.fail === 0;
    },
  };
}

/** Named fixtures the policy tests reason about. */
export const USERS = Object.fromEntries(DEMO_KEYS.map(([key, id]) => [key, id]));

/** Roles rather than raw keys, so the assertions read as intent. */
export const FIXTURES = {
  employerVerified: USERS.employer1, // Al Rowad — verified
  employerUnverified: USERS.employer2, // Property Hub — unverified
  candidate: USERS.candidate1, // gated agent profile
  publicAgent: USERS.candidate2, // public agent profile
  hiddenAgent: USERS.candidate5, // hidden from everyone
  admin: USERS.admin,
};
