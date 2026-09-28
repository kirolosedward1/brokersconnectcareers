/**
 * Two cleanup workers at once, against a real Postgres.
 *
 * PGlite is one connection, so it can show that a second call finds nothing
 * left to do — it cannot show that two calls *in flight together* stay out of
 * each other's way. That needs two backends: one transaction holding its
 * locks open while the other runs.
 *
 *   the whole run     pg_try_advisory_xact_lock: the second worker records
 *                     "skipped" and returns instead of queueing
 *   expiry batches    `for update skip locked`: the second worker takes the
 *                     rows the first is not holding, and does not block
 *   storage claims    the same, plus a lease that outlives the transaction
 *
 * Needs the Postgres server binaries (initdb, pg_ctl) and the pgcrypto and
 * unaccent contrib modules. Where they are not installed this says so and
 * exits 0 — it is an extra proof, not a gate a laptop without Postgres should
 * fail. Set PG_BIN to point at a specific install.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { GRANTS, PRELUDE, reporter } from './setup.mjs';

const SUPABASE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

function findBin() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const root = '/usr/lib/postgresql';
  if (!existsSync(root)) return null;
  const versions = readdirSync(root).sort((a, b) => Number(b) - Number(a));
  for (const v of versions) {
    const bin = join(root, v, 'bin');
    if (existsSync(join(bin, 'initdb')) && existsSync(join(bin, 'pg_ctl'))) return bin;
  }
  return null;
}

const BIN = findBin();
if (!BIN) {
  console.log('lifecycle-concurrency: no Postgres server binaries found — skipped (set PG_BIN to run it).');
  process.exit(0);
}

// initdb refuses to run as root; in a container that is who we are.
const asRoot = process.getuid?.() === 0;
function pgCmd(tool, args) {
  const file = join(BIN, tool);
  return asRoot
    ? execFileSync('runuser', ['-u', 'postgres', '--', file, ...args], { stdio: 'pipe' })
    : execFileSync(file, args, { stdio: 'pipe' });
}

const dir = mkdtempSync(join(tmpdir(), 'lifecycle-pg-'));
if (asRoot) {
  chmodSync(dir, 0o777);
  spawnSync('chown', ['postgres', dir]);
}
const data = join(dir, 'data');
const port = 55432 + Math.floor(Math.random() * 1000);

let started = false;
const report = reporter();

try {
  pgCmd('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-sync']);
  pgCmd('pg_ctl', ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1`, '-w', 'start', '-l', join(dir, 'log')]);
  started = true;

  const connect = async () => {
    const client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
    await client.connect();
    return client;
  };

  const setup = await connect();
  await setup.query(PRELUDE);
  for (const file of readdirSync(join(SUPABASE_DIR, 'migrations')).sort()) {
    if (file.endsWith('.sql')) await setup.query(readFileSync(join(SUPABASE_DIR, 'migrations', file), 'utf8'));
  }
  await setup.query(readFileSync(join(SUPABASE_DIR, 'seed.sql'), 'utf8'));
  await setup.query(GRANTS);

  // One company with a backlog of ended listings, and three files waiting.
  const OWNER = 'bbbbbbbb-0000-0000-0000-000000000001';
  const CO = 'bbbbbbbb-1111-0000-0000-000000000001';
  await setup.query(`
    insert into auth.users (id, email, created_at) values ('${OWNER}', 'owner@demo.test', now());
    insert into profiles (id, role, full_name, whatsapp_phone) values ('${OWNER}', 'employer', 'مالك', '+201000000002');
    insert into companies (id, owner_id, name_ar, slug, verification_status)
      values ('${CO}', '${OWNER}', 'شركة', 'concurrency-co', 'verified');
    insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band, district_id,
                      commission_type, leads_source, description_ar, status, published_at, expires_at)
    select '${CO}', 'وظيفة ' || g, 'conc-' || g, 'primary', 'full_time', 'junior_1_3',
           (select id from districts limit 1), 'none', 'company_provided', 'وصف', 'active',
           now() - interval '40 days', now() - interval '10 days'
      from generate_series(1, 6) g;
    insert into storage.objects (bucket_id, name, created_at)
    select 'cvs', 'orphan/' || g || '.pdf', now() - interval '3 days' from generate_series(1, 3) g;
    insert into storage_gc_queue (bucket, path, reason, not_before)
    select 'cvs', 'orphan/' || g || '.pdf', 'orphan_scan', now() - interval '1 minute' from generate_series(1, 3) g;
  `);

  const a = await connect();
  const b = await connect();
  // Neither blocks for long: if skip locked or the try-lock were wrong, the
  // second statement would wait on the first and this is what would say so.
  await b.query(`set statement_timeout = '5s'`);

  // ------------------------------------------------------------------ run --
  report.section('the whole run, twice at once');

  await a.query('begin');
  const first = (await a.query(`select public.run_lifecycle_maintenance() as r`)).rows[0].r;
  const second = (await b.query(`select public.run_lifecycle_maintenance() as r`)).rows[0].r;
  report.check('the first worker runs', first.status === 'ok', JSON.stringify(first));
  report.check('the second steps aside instead of waiting', second.status === 'skipped', JSON.stringify(second));
  await a.query('commit');

  const runs = (await setup.query(`select status from maintenance_runs order by id`)).rows.map((r) => r.status);
  report.check('both are in the run log', runs.includes('ok') && runs.includes('skipped'), runs.join(','));

  // --------------------------------------------------------------- expiry --
  report.section('expiry batches, twice at once');

  // Fresh listings: putting the first batch back to `active` would give them
  // a new thirty-day window (migration 46), which is the repost rule working.
  await setup.query(`
    insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band, district_id,
                      commission_type, leads_source, description_ar, status, published_at, expires_at)
    select '${CO}', 'وظيفة ثانية ' || g, 'conc2-' || g, 'primary', 'full_time', 'junior_1_3',
           (select id from districts limit 1), 'none', 'company_provided', 'وصف', 'active',
           now() - interval '40 days', now() - interval '10 days'
      from generate_series(1, 6) g;
  `);
  await a.query('begin');
  const aTook = (await a.query(`select public.expire_stale_jobs(2) as n`)).rows[0].n;
  const bTook = (await b.query(`select public.expire_stale_jobs(100) as n`)).rows[0].n;
  await a.query('commit');
  report.check('the first takes its two', aTook === 2, String(aTook));
  report.check('the second takes the other four without waiting for them', bTook === 4, String(bTook));
  const left = (await setup.query(`select count(*)::int as n from jobs where slug like 'conc2-%' and status = 'active'`)).rows[0].n;
  report.check('and together they expired each listing exactly once', left === 0);

  // -------------------------------------------------------------- storage --
  report.section('storage claims, twice at once');

  await a.query('begin');
  const aFiles = (await a.query(`select path from public.claim_storage_gc(1)`)).rows.map((r) => r.path);
  const bFiles = (await b.query(`select path from public.claim_storage_gc(10)`)).rows.map((r) => r.path);
  await a.query('commit');
  const overlap = aFiles.filter((p) => bFiles.includes(p));
  report.check('two workers claiming together get disjoint files',
    aFiles.length === 1 && bFiles.length === 2 && overlap.length === 0, `${aFiles} | ${bFiles}`);

  const third = (await b.query(`select path from public.claim_storage_gc(10)`)).rows;
  report.check('and a third, after both committed, gets nothing still leased', third.length === 0);

  await a.end();
  await b.end();
  await setup.end();
} catch (error) {
  report.check('the concurrency harness ran', false, error.message);
} finally {
  if (started) {
    try {
      pgCmd('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']);
    } catch {
      // Already gone; nothing to stop.
    }
  }
  rmSync(dir, { recursive: true, force: true });
}

process.exit(report.finish() ? 0 : 1);
