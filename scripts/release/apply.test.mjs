#!/usr/bin/env node
/**
 * `migrations.mjs apply`, end to end, against production's history.
 *
 * Rebuilds the database production's ledger describes (the snapshot in
 * fixtures/, read 2026-09-28) in throwaway Postgres, serves it on a local
 * socket, and runs the real command against it — the same `pg` client, the
 * same transactions, the same ledger writes as on the day. Then checks what
 * the command left behind: every pending file applied and recorded, the one
 * adjustment recorded beside its file, a second run finding nothing, and a
 * database identical to a fresh build of main.
 *
 * Also the refusals: production without --confirm, a ledger with drift, the
 * transaction pooler.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { ROOT } from '../env.mjs';
import { reporter } from '../../supabase/tests/setup.mjs';
import { buildFromLedger, compare, fingerprint, freshBuild } from './rehearse.mjs';

const PORT = 5435;
const PRODUCTION_REF = 'hiwdhicwsohbipxzazmb';
// Local, but carrying production's ref, so the command treats it as production.
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres?application_name=${PRODUCTION_REF}`;

const ledger = JSON.parse(readFileSync(join(ROOT, 'scripts', 'release', 'fixtures', 'production-ledger-2026-09-28.json'), 'utf8'));
const t = reporter();

/**
 * The command, as a child process. Asynchronously: the database it talks to
 * lives in this process, and has to keep answering while the child runs.
 */
function apply(...args) {
  return new Promise((resolve) => {
    const child = spawn('node', [join(ROOT, 'scripts', 'release', 'migrations.mjs'), 'apply', ...args], {
      env: { ...process.env, TARGET_DATABASE_URL: args.includes('--pooler') ? URL.replace(`:${PORT}`, ':6543') : URL },
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => resolve({ code, out }));
  });
}

const { db } = await buildFromLedger({ ledgerRows: ledger.migrations });
const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
await server.start();

const ledgerCount = async () => Number((await db.query('select count(*)::int as n from supabase_migrations.schema_migrations')).rows[0].n);

try {
  t.section('the plan, without applying it');
  const dry = await apply();
  t.check('a dry run succeeds', dry.code === 0, dry.out);
  t.check('and lists the 25 files production is missing', /25 to apply/.test(dry.out), dry.out);
  t.check("and names the files production ran ahead of main's order", /ran ahead of main's order: .*203.*316/.test(dry.out));
  t.check('and applies nothing', (await ledgerCount()) === ledger.migrations.length);

  t.section('refusals');
  const unconfirmed = await apply('--execute');
  t.check('production without --confirm is refused', unconfirmed.code === 1 && /--confirm hiwdhicwsohbipxzazmb/.test(unconfirmed.out), unconfirmed.out);
  t.check('and nothing was applied', (await ledgerCount()) === ledger.migrations.length);
  const pooled = await apply('--pooler');
  t.check('the transaction pooler is refused before connecting', pooled.code === 2 && /6543/.test(pooled.out), pooled.out);

  await db.query("insert into supabase_migrations.schema_migrations (version, name) values ('20990101000000', 'something_nobody_merged')");
  const drifted = await apply('--execute', '--confirm', PRODUCTION_REF);
  t.check('a ledger with drift is refused', drifted.code === 1 && /something_nobody_merged/.test(drifted.out), drifted.out);
  await db.query("delete from supabase_migrations.schema_migrations where version = '20990101000000'");
  t.check('and nothing was applied', (await ledgerCount()) === ledger.migrations.length);

  t.section('applied');
  const real = await apply('--execute', '--confirm', PRODUCTION_REF);
  t.check('every pending file applies', real.code === 0 && /applied 25/.test(real.out), real.out);
  t.check('each is recorded in the ledger', (await ledgerCount()) === ledger.migrations.length + 25);

  const { rows: adjusted } = await db.query(
    "select statements from supabase_migrations.schema_migrations where version = '20260101000307'",
  );
  t.check(
    'the adjustment is recorded beside its file',
    adjusted[0]?.statements?.length === 3 && /drop constraint if exists reports_detail_length/.test(adjusted[0].statements[0]),
  );

  const again = await apply();
  t.check('a second run finds nothing pending', again.code === 0 && /nothing pending/.test(again.out), again.out);

  t.section('the result');
  const fresh = await freshBuild();
  const diff = compare(await fingerprint(fresh), await fingerprint(db));
  t.check(
    'is the database main builds, object for object',
    diff.same,
    [...diff.onlyLeft, ...diff.onlyRight, ...diff.changed].slice(0, 10).join(', '),
  );
  await fresh.close();
} finally {
  await server.stop();
  await db.close();
}

process.exit(t.finish() ? 0 : 1);
