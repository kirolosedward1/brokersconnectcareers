/**
 * Every database request the app makes, sent to the real thing.
 *
 *   RECORD_REQUESTS=/tmp/requests.jsonl npx jest        (in mobile/)
 *   POSTGREST_BIN=/path/to/postgrest node scripts/contract/replay.mjs /tmp/requests.jsonl
 *
 * The app's tests answer Supabase's REST endpoint from fixtures, so a select
 * naming a column the schema does not have, an embed with no relationship
 * behind it, an RPC called with arguments its function does not take, or a
 * table the app's role may not read, passes there and fails on the phone.
 * This builds a real Postgres 16 from every migration and the seeds, puts a
 * real PostgREST in front of it, and replays each distinct request the tests
 * recorded, signed as a seeded user of the kind the test was (or as anon).
 *
 * The database is built the way Supabase builds one: anon, authenticated and
 * service_role are granted what a new table or function in `public` gets by
 * default privileges, before the migrations run, so a migration's revoke
 * stands as it does in production. auth.uid() reads the claims PostgREST
 * sets. Rows are seeded, but most recorded filters name fixture ids that are
 * not there: an empty answer is a pass. What fails is the shape of the
 * request — see CONTRACT below — and those are reported with the test that
 * made the request.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { chownSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { PRELUDE, testDbScripts } from '../../supabase/tests/setup.mjs';

const RECORDED = process.argv[2];
if (!RECORDED || !existsSync(RECORDED)) {
  console.error('usage: node scripts/contract/replay.mjs <requests.jsonl> (recorded with RECORD_REQUESTS in mobile/)');
  process.exit(2);
}
const POSTGREST = process.env.POSTGREST_BIN;
if (!POSTGREST || !existsSync(POSTGREST)) {
  console.error('POSTGREST_BIN must point at a PostgREST 12 binary');
  process.exit(2);
}
const PG_BIN = process.env.PG_BIN ?? '/usr/lib/postgresql/16/bin';
const SECRET = 'contract-replay-secret-of-at-least-thirty-two-chars';

// The seeded users the replay signs as (supabase/tests/setup.mjs DEMO_KEYS).
const EMPLOYER = '11111111-1111-1111-1111-111111111111';
const CANDIDATE = '33333333-3333-3333-3333-333333333333';
// Test files whose signed-in user is an employer; every other file's is a candidate.
const EMPLOYER_FILES = /^(applicants|company|directory|employer|job-form)\.test\./;

/**
 * Errors that mean the request itself does not fit the schema or the grants,
 * whatever the rows: these fail on the phone too. Anything else (a fixture id
 * that is not a uuid, a constraint, a function refusing on purpose) is the
 * data's doing and passes.
 */
const CONTRACT = new Set([
  'PGRST100', // the query string does not parse
  'PGRST106', // schema not exposed
  'PGRST200', // no relationship for an embed
  'PGRST201', // ambiguous embed
  'PGRST202', // no function with these arguments
  'PGRST203', // ambiguous function
  'PGRST204', // a written column the table does not have
  'PGRST205', // no such table
  '42703', // undefined column
  '42P01', // undefined table
  '42883', // undefined function or operator
  '42804', // datatype mismatch
  '42P10', // invalid column reference
]);

const cleanups = [];
async function cleanup() {
  for (const step of cleanups.reverse()) {
    try {
      await step();
    } catch {
      // Best effort.
    }
  }
}

function freePort() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
function pgBin(tool, args) {
  const command = asRoot ? 'runuser' : join(PG_BIN, tool);
  const argv = asRoot ? ['-u', 'postgres', '--', join(PG_BIN, tool), ...args] : args;
  const result = spawnSync(command, argv, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${tool} failed: ${result.stderr || result.stdout || result.error?.message}`);
}
function chownTree(path, uid, gid) {
  chownSync(path, uid, gid);
  if (statSync(path).isDirectory()) for (const entry of readdirSync(path)) chownTree(join(path, entry), uid, gid);
}

async function startCluster() {
  const dir = mkdtempSync(join(tmpdir(), 'bcc-contract-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  if (asRoot) {
    const uid = Number(spawnSync('id', ['-u', 'postgres'], { encoding: 'utf8' }).stdout.trim());
    const gid = Number(spawnSync('id', ['-g', 'postgres'], { encoding: 'utf8' }).stdout.trim());
    chownTree(dir, uid, gid);
  }
  const data = join(dir, 'data');
  pgBin('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C', '--no-sync']);
  const port = await freePort();
  pgBin('pg_ctl', [
    '-D', data, '-l', join(dir, 'server.log'),
    '-o', `-p ${port} -k ${dir} -c listen_addresses='' -c fsync=off -c max_connections=60`,
    '-w', 'start',
  ]);
  cleanups.push(() => pgBin('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']));
  return { host: dir, port };
}

/** What Supabase grants and defines before any migration runs. */
const SUPABASE_DEFAULTS = `
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
-- Supabase's own auth.uid(): PostgREST 12 sets the claims as one JSON setting.
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$fn$;
`;

function sign(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}`;
  return `${head}.${createHmac('sha256', SECRET).update(head).digest('base64url')}`;
}

function claimsOf(authorization) {
  const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
  const [, payload] = token.split('.');
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
}

/** The request's shape: what makes two recorded requests the same check. */
const SHAPE_PARAMS = new Set(['select', 'order', 'or', 'and', 'columns', 'on_conflict']);
function shapeOf(record) {
  const url = new URL(record.url);
  const params = [...url.searchParams.entries()]
    .map(([key, value]) => (SHAPE_PARAMS.has(key) ? `${key}=${value}` : `${key}~${value.split('.')[0]}`))
    .filter((entry) => !entry.startsWith('limit~') && !entry.startsWith('offset~'))
    .sort();
  const body = record.body;
  const keys = Array.isArray(body) ? Object.keys(body[0] ?? {}) : body && typeof body === 'object' ? Object.keys(body) : [];
  return `${record.method} ${url.pathname} ${params.join('&')} body:${keys.sort().join(',')} prefer:${record.headers.prefer ?? ''}`;
}

async function main() {
  const records = readFileSync(RECORDED, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((record) => new URL(record.url).pathname.startsWith('/rest/v1/'));

  const distinct = new Map();
  for (const record of records) {
    const key = shapeOf(record);
    if (!distinct.has(key)) distinct.set(key, { record, tests: new Set() });
    distinct.get(key).tests.add(`${record.file} › ${record.test}`);
  }

  const cluster = await startCluster();
  const admin = new pg.Client({ host: cluster.host, port: cluster.port, user: 'postgres', database: 'postgres' });
  await admin.connect();
  cleanups.push(() => admin.end());
  for (const script of testDbScripts()) {
    if (script.name === 'grants') continue; // Supabase's defaults, set before the migrations, stand in for it.
    const sql = script.name === 'prelude' ? `${PRELUDE}\n${SUPABASE_DEFAULTS}` : script.sql;
    try {
      await admin.query(sql);
    } catch (error) {
      throw new Error(`applying ${script.name}: ${error.message}`);
    }
  }
  await admin.query(`
    create role authenticator noinherit login;
    grant anon, authenticated, service_role to authenticator;`);

  const port = await freePort();
  const rest = spawn(POSTGREST, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: `postgres://authenticator@/postgres?host=${encodeURIComponent(cluster.host)}&port=${cluster.port}`,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_DB_EXTRA_SEARCH_PATH: 'public,extensions',
      PGRST_JWT_SECRET: SECRET,
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(port),
      PGRST_DB_CHANNEL_ENABLED: 'false',
      PGRST_DB_POOL: '10',
      PGRST_LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  cleanups.push(() => rest.kill('SIGTERM'));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i += 1) {
    try {
      if ((await fetch(`${base}/`)).ok) break;
    } catch {
      // Not up yet.
    }
    if (i > 100) throw new Error('PostgREST did not start');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const failures = [];
  const answers = new Map();
  let passed = 0;
  for (const [shape, { record, tests }] of distinct) {
    const url = new URL(record.url);
    const claims = claimsOf(record.headers.authorization);
    const headers = {};
    if (claims?.role === 'authenticated') {
      const sub = EMPLOYER_FILES.test(record.file ?? '') ? EMPLOYER : CANDIDATE;
      headers.authorization = `Bearer ${sign({ role: 'authenticated', aud: 'authenticated', sub, aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    }
    for (const name of ['prefer', 'accept', 'content-type']) if (record.headers[name]) headers[name] = record.headers[name];
    const target = `${base}${url.pathname.replace(/^\/rest\/v1/, '')}${url.search}`;
    const send = (method) =>
      fetch(target, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' || record.body === undefined ? undefined : JSON.stringify(record.body),
      });
    // A HEAD answers no body: ask the same as a GET to hear why it failed.
    let response = await send(record.method);
    if (!response.ok && record.method === 'HEAD') response = await send('GET');
    if (response.ok) {
      passed += 1;
      continue;
    }
    let error;
    try {
      error = await response.json();
    } catch {
      error = { message: `HTTP ${response.status}` };
    }
    // PGRST3xx is the token being refused: the harness is wrong, not the app.
    if (/^PGRST3/.test(error.code ?? '')) throw new Error(`PostgREST refused the replay's token: ${error.message}`);
    const denied = error.code === '42501' && /permission denied for/i.test(error.message ?? '');
    if (CONTRACT.has(error.code) || denied) {
      failures.push({ shape, status: response.status, error, tests: [...tests] });
    } else {
      const tally = `${response.status} ${error.code ?? '-'}`;
      answers.set(tally, (answers.get(tally) ?? 0) + 1);
      passed += 1;
    }
  }

  console.log(`${distinct.size} distinct requests from ${records.length} recorded: ${passed} fit the schema, ${failures.length} do not.`);
  if (answers.size) console.log(`Refusals that are the data's doing: ${[...answers].map(([tally, n]) => `${tally} ×${n}`).join(', ')}`);
  for (const failure of failures) {
    console.log(`\nFAIL  ${failure.shape}`);
    console.log(`      ${failure.status} ${failure.error.code}: ${failure.error.message}${failure.error.hint ? ` (${failure.error.hint})` : ''}`);
    for (const test of failure.tests.slice(0, 3)) console.log(`      from ${test}`);
  }
  return failures.length === 0;
}

let ok = false;
try {
  ok = await main();
} catch (error) {
  console.error(error);
} finally {
  await cleanup();
}
process.exit(ok ? 0 : 1);
