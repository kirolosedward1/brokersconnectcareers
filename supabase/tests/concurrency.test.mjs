/**
 * The races, run as races: several connections to a real Postgres at once.
 *
 *   pnpm test:concurrency
 *
 * Every other database test runs on PGlite, which is one connection — so
 * "two sweepers lease the same row" can only ever be two sweepers taking
 * turns there, and taking turns is exactly the case that was never broken.
 * The claims the background-work design rests on are about overlap:
 *
 *   lease_due_emails   FOR UPDATE SKIP LOCKED — two sweepers get disjoint rows
 *   begin_job_run      the unique index on running rows — one run per job
 *   expire_stale_jobs  one UPDATE whose WHERE is re-checked after a lock wait
 *                      under READ COMMITTED — each listing flips exactly once,
 *                      and an owner's close that got there first stays closed
 *   claim_email        the unique dedupe key — one row, one id, per message
 *
 * Each is shown twice where it matters: once with the interleaving forced
 * (one transaction holds its locks while the other is observed waiting, or
 * observed *not* waiting, in pg_locks) and once as a plain Promise.all
 * stampede. The forced one proves the mechanism; the stampede proves nothing
 * else was relying on luck.
 *
 * The server: TEST_DATABASE_URL if set (a superuser URL; a scratch database is
 * created on it and dropped afterwards), otherwise a throwaway cluster from
 * the Postgres 16 binaries, in a temp dir, on a random port, with its unix
 * socket in the same dir. Neither available: SKIP, exit 0 — this is a check a
 * laptop without Postgres should not fail.
 *
 * The schema is built from the same ordered scripts as the PGlite harness
 * (setup.mjs → testDbScripts), so both test the same database.
 */
import { spawnSync } from 'node:child_process';
import { chownSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { reporter, testDbScripts } from './setup.mjs';

const BIN = process.env.PG_BIN ?? '/usr/lib/postgresql/16/bin';
const URL_FROM_ENV = process.env.TEST_DATABASE_URL;

if (!URL_FROM_ENV && !existsSync(join(BIN, 'initdb'))) {
  console.log(`SKIP  no TEST_DATABASE_URL and no Postgres binaries at ${BIN}`);
  process.exit(0);
}

const report = reporter();
const cleanups = [];

async function cleanup() {
  while (cleanups.length) {
    const fn = cleanups.pop();
    try {
      await fn();
    } catch (error) {
      console.error(`cleanup: ${error.message}`);
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await cleanup();
    process.exit(130);
  });
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * initdb refuses to run as root, and a sandbox or CI container is often root.
 * Then the cluster is owned by, and run as, the postgres system user.
 */
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;

function pgBin(tool, args) {
  const command = asRoot ? 'runuser' : join(BIN, tool);
  const argv = asRoot ? ['-u', 'postgres', '--', join(BIN, tool), ...args] : args;
  const result = spawnSync(command, argv, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${tool} failed (${result.status}): ${result.stderr || result.stdout || result.error?.message}`);
  }
  return result.stdout;
}

function chownTree(path, uid, gid) {
  chownSync(path, uid, gid);
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) chownTree(join(path, entry), uid, gid);
  }
}

async function startCluster() {
  const dir = mkdtempSync(join(tmpdir(), 'bcc-concurrency-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

  if (asRoot) {
    const uid = Number(spawnSync('id', ['-u', 'postgres'], { encoding: 'utf8' }).stdout.trim());
    const gid = Number(spawnSync('id', ['-g', 'postgres'], { encoding: 'utf8' }).stdout.trim());
    if (!Number.isInteger(uid) || !Number.isInteger(gid)) throw new Error('running as root but there is no postgres user');
    chownTree(dir, uid, gid);
  }

  const data = join(dir, 'data');
  pgBin('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C', '--no-sync']);

  const port = await freePort();
  pgBin('pg_ctl', [
    '-D', data,
    '-l', join(dir, 'server.log'),
    '-o', `-p ${port} -k ${dir} -c listen_addresses='' -c fsync=off -c max_connections=50`,
    '-w', 'start',
  ]);
  cleanups.push(() => pgBin('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']));

  return { host: dir, port, user: 'postgres', database: 'postgres' };
}

async function scratchDatabaseOn(url) {
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const name = `bcc_concurrency_${process.pid}_${Date.now()}`;
  await admin.query(`create database ${name}`);
  cleanups.push(async () => {
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  });
  const target = new URL(url);
  target.pathname = `/${name}`;
  return { connectionString: target.toString() };
}

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

let config;
try {
  config = URL_FROM_ENV ? await scratchDatabaseOn(URL_FROM_ENV) : await startCluster();
} catch (error) {
  await cleanup();
  console.error(`could not start Postgres: ${error.message}`);
  process.exit(1);
}

const clients = [];
async function connect() {
  const client = new pg.Client(config);
  await client.connect();
  clients.push(client);
  return client;
}
cleanups.push(async () => {
  for (const c of clients) await c.end().catch(() => {});
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves once `pid` is waiting on a lock it has not been granted. */
async function waitUntilBlocked(observer, pid, label) {
  for (let i = 0; i < 200; i += 1) {
    const { rows } = await observer.query('select count(*)::int as n from pg_locks where pid = $1 and not granted', [pid]);
    if (rows[0].n > 0) return true;
    await sleep(25);
  }
  throw new Error(`${label}: the second transaction never blocked`);
}

/** A promise that settles within `ms`, or says it did not. */
const within = (promise, ms) =>
  Promise.race([promise.then((value) => ({ value })), sleep(ms).then(() => ({ timedOut: true }))]);

async function main() {
  const setup = await connect();
  for (const script of testDbScripts()) {
    try {
      await setup.query(script.sql);
    } catch (error) {
      throw new Error(`applying ${script.name}: ${error.message}`);
    }
  }
  report.check('the migrations, seed and grants apply to a real Postgres 16', true);

  const observer = await connect();
  const [a, b, ...more] = await Promise.all(Array.from({ length: 10 }, () => connect()));
  const everyone = [a, b, ...more];

  // -------------------------------------------------------------------------
  report.section('two workers: concurrent leases take disjoint rows');
  {
    for (let i = 0; i < 25; i += 1) {
      await setup.query(`select public.claim_email($1, 'application_status', 'someone@brokersconnect.net')`, [`race:lease:${i}`]);
    }
    await setup.query(`update email_log set next_attempt_at = now() - interval '1 second' where dedupe_key like 'race:lease:%'`);

    // Forced: A leases and holds its row locks; B must skip them, not wait.
    await a.query('begin');
    const { rows: leasedA } = await a.query('select * from public.lease_due_emails(5, 120)');
    const bResult = await within(b.query('select * from public.lease_due_emails(5, 120)'), 5000);
    await a.query('commit');

    report.check('worker B did not wait on worker A\'s locked rows (SKIP LOCKED)', !bResult.timedOut);
    const leasedB = bResult.value?.rows ?? [];
    const idsA = new Set(leasedA.map((r) => r.id));
    report.check('A and B each leased a full batch', leasedA.length === 5 && leasedB.length === 5,
      `A=${leasedA.length} B=${leasedB.length}`);
    report.check('with no row in both', leasedB.every((r) => !idsA.has(r.id)));

    // Stampede: the fifteen left, eight workers at once.
    const batches = await Promise.all(everyone.slice(0, 8).map((c) => c.query('select * from public.lease_due_emails(4, 120)')));
    const all = batches.flatMap((r) => r.rows.map((row) => row.id));
    report.check('eight simultaneous sweepers lease the remaining fifteen rows between them', all.length === 15, `got ${all.length}`);
    report.check('each exactly once', new Set(all).size === all.length);
    const { rows: tokens } = await setup.query(
      `select count(*)::int as n from email_log where dedupe_key like 'race:lease:%' and leases = 1 and lock_token is not null`,
    );
    report.check('and every row carries exactly one lease', tokens[0].n === 25, `got ${tokens[0].n}`);
  }

  // -------------------------------------------------------------------------
  report.section('duplicate execution: N concurrent begin_job_run for one job');
  {
    // Forced: A has inserted its running row but not committed; B's insert
    // waits on the unique index, then finds the conflict and stands aside.
    await a.query('begin');
    const { rows: [{ id: first }] } = await a.query(`select public.begin_job_run('race-forced', 60) as id`);
    const { rows: [{ pid }] } = await b.query('select pg_backend_pid() as pid');
    const pending = b.query(`select public.begin_job_run('race-forced', 60) as id`);
    await waitUntilBlocked(observer, pid, 'begin_job_run');
    await a.query('commit');
    const { rows: [{ id: second }] } = await pending;
    report.check('the first run gets an id', Boolean(first));
    report.check('the second, having waited on the first\'s uncommitted row, gets null', second === null);

    const results = await Promise.all(
      everyone.map((c) => c.query(`select public.begin_job_run('race-stampede', 60) as id`)),
    );
    const ids = results.map((r) => r.rows[0].id).filter(Boolean);
    report.check(`${everyone.length} simultaneous begins: exactly one run id`, ids.length === 1, `got ${ids.length}`);
    const { rows } = await setup.query(
      `select status, count(*)::int as n from job_runs where job = 'race-stampede' group by status order by status`,
    );
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    report.check('one running row', byStatus.running === 1, JSON.stringify(byStatus));
    report.check(`and ${everyone.length - 1} skipped rows recording the overlap`, byStatus.skipped === everyone.length - 1, JSON.stringify(byStatus));
  }

  // -------------------------------------------------------------------------
  report.section('duplicate execution: concurrent expiry flips each listing once');
  {
    const { rows: live } = await setup.query(`select id from jobs where status = 'active' order by id`);
    report.check(`the seed has live listings to expire (${live.length})`, live.length >= 8);
    const forced = live.slice(0, 4).map((j) => j.id);
    const stampede = live.slice(4, 8).map((j) => j.id);

    await setup.query(`update jobs set expires_at = now() - interval '1 hour' where id = any($1)`, [forced]);
    // Since migration 204 expiry takes its rows FOR UPDATE SKIP LOCKED: a
    // second run does not wait behind the first, it passes over the rows the
    // first holds — and so can never flip one of them a second time.
    await a.query('begin');
    const { rows: [{ n: nA }] } = await a.query('select public.expire_stale_jobs() as n');
    const { rows: [{ n: nB }] } = await b.query('select public.expire_stale_jobs() as n');
    await a.query('commit');
    report.check('the first run expires the four', nA === 4, `got ${nA}`);
    report.check('the second, running while the first holds them, skips all four rather than waiting', nB === 0, `got ${nB}`);
    const { rows: [{ n: nC }] } = await b.query('select public.expire_stale_jobs() as n');
    report.check('and a run after the first commits finds nothing left to flip', nC === 0, `got ${nC}`);

    await setup.query(`update jobs set expires_at = now() - interval '1 hour' where id = any($1)`, [stampede]);
    const counts = await Promise.all(everyone.slice(0, 4).map((c) => c.query('select public.expire_stale_jobs() as n')));
    const sum = counts.reduce((total, r) => total + r.rows[0].n, 0);
    report.check('four simultaneous runs: the flips sum to the four listings, not more', sum === 4, `got ${sum}`);
    const { rows: statuses } = await setup.query(
      `select count(*)::int as n from jobs where id = any($1) and status = 'expired'`,
      [[...forced, ...stampede]],
    );
    report.check('all eight are expired', statuses[0].n === 8);
  }

  // -------------------------------------------------------------------------
  report.section('a manual close racing expiry ends closed');
  {
    const { rows: live } = await setup.query(
      `select j.id, c.owner_id from jobs j join companies c on c.id = j.company_id
        where j.status = 'active' order by j.id limit 2`,
    );
    const [closeFirst, expireFirst] = live;
    await setup.query(`update jobs set expires_at = now() - interval '1 minute' where id = $1`, [closeFirst.id]);

    const asOwner = async (client, ownerId) => {
      await client.query('set local role authenticated');
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ownerId]);
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub: ownerId })]);
    };

    // The owner's close holds the row; expiry skips it (SKIP LOCKED) rather
    // than overwrite or wait, and after the commit it is no longer active.
    await a.query('begin');
    await asOwner(a, closeFirst.owner_id);
    const { rowCount: closed } = await a.query(`update jobs set status = 'closed' where id = $1`, [closeFirst.id]);
    const { rows: [{ pid }] } = await b.query('select pg_backend_pid() as pid');
    await b.query('select public.expire_stale_jobs() as n');
    await a.query('commit');
    await b.query('select public.expire_stale_jobs() as n');
    report.check('the owner\'s close went through', closed === 1);
    const { rows: [one] } = await setup.query('select status from jobs where id = $1', [closeFirst.id]);
    report.check('close first, expiry running meanwhile: the listing ends closed, not expired', one.status === 'closed', one.status);

    // The other way round: expiry holds the row; the owner's close waits and
    // then closes an expired listing, which the guard allows.
    // Past its window only now, so the waiting expiry above left it alone.
    await setup.query(`update jobs set expires_at = now() - interval '1 minute' where id = $1`, [expireFirst.id]);
    await a.query('begin');
    await a.query('select public.expire_stale_jobs()');
    await b.query('begin');
    await asOwner(b, expireFirst.owner_id);
    const closing = b.query(`update jobs set status = 'closed' where id = $1`, [expireFirst.id]);
    await waitUntilBlocked(observer, pid, 'close behind an expiry');
    await a.query('commit');
    const { rowCount } = await closing;
    await b.query('commit');
    const { rows: [two] } = await setup.query('select status from jobs where id = $1', [expireFirst.id]);
    report.check('expiry first, close waiting: the close still lands', rowCount === 1 && two.status === 'closed', two.status);
  }

  // -------------------------------------------------------------------------
  report.section('duplicate execution: concurrent claims on one key');
  {
    const results = await Promise.all(
      everyone.map((c) =>
        c.query(`select public.claim_email('race:claim:1', 'application_status', 'someone@brokersconnect.net') as id`),
      ),
    );
    const ids = results.map((r) => r.rows[0].id).filter(Boolean);
    report.check(`${everyone.length} simultaneous claims: exactly one id`, ids.length === 1, `got ${ids.length}`);
    const { rows } = await setup.query(`select count(*)::int as n from email_log where dedupe_key = 'race:claim:1'`);
    report.check('and exactly one row', rows[0].n === 1);

    // The same, with a lease in play: a composer re-run under the lease token
    // racing a stray one without it. Only the token holder gets the row.
    await setup.query(`update email_log set next_attempt_at = now() - interval '1 second' where dedupe_key = 'race:claim:1'`);
    const { rows: [leased] } = await setup.query(
      `select * from public.lease_due_emails(100, 120) where id = $1`,
      [ids[0]],
    );
    const [withToken, without] = await Promise.all([
      a.query(`select public.claim_email('race:claim:1', 'application_status', 'someone@brokersconnect.net', null, null, null, false, $1) as id`, [leased?.lock_token]),
      b.query(`select public.claim_email('race:claim:1', 'application_status', 'someone@brokersconnect.net') as id`),
    ]);
    report.check('the lease holder gets the same row back', withToken.rows[0].id === ids[0]);
    report.check('the stray claim racing it gets nothing', without.rows[0].id === null);
  }

}

let failed = false;
try {
  await main();
} catch (error) {
  failed = true;
  console.error(`\nERROR  ${error.message}`);
} finally {
  await cleanup();
}

const passed = report.finish();
process.exitCode = passed && !failed ? 0 : 1;
