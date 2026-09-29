#!/usr/bin/env node
/**
 * Rehearses bringing a database's migrations up to this checkout, before it
 * is done for real with `migrations.mjs apply`.
 *
 *   node scripts/release/rehearse.mjs --ledger <ledger.json>
 *        [--statements <statements.json>] [--fingerprint <fingerprint.json>]
 *
 *   --ledger       the database's applied history, as Supabase's
 *                  list_migrations returns it ({ migrations: [{version, name}] })
 *   --statements   what the database stored for each row
 *                  (select version, name, statements from
 *                  supabase_migrations.schema_migrations), as JSON rows; a row
 *                  listed here is replayed from what was stored, not from the
 *                  file of the same name
 *   --fingerprint  scripts/dr/fingerprint.sql run on the real database, as
 *                  JSON rows ({kind, name, hash})
 *   --keep-going   carry on past a failing step, to see every collision at
 *                  once (the real apply always stops at the first)
 *
 * What it does, all in throwaway in-process Postgres (PGlite):
 *
 *   1. Rebuilds the database the ledger describes — the Supabase stand-ins,
 *      then every file the ledger names, in the ledger's order, which is the
 *      order the database ran them in. Files applied by hand (UNRECORDED in
 *      migrations.mjs) go in at their place in file order.
 *   2. With --fingerprint, proves the rebuild is that database, object by
 *      object. Without it, says the rebuild is unverified.
 *   3. Runs the reconciliation plan the way `apply` will
 *      (reconciliationPlan in migrations.mjs): each pending file in file
 *      order, with its adjustments, in its own transaction with its ledger
 *      row.
 *   4. Builds this checkout fresh, in file order, and compares: the reconciled
 *      database has to be the one main builds, whatever order it got there in.
 *   5. Loads the seed and the demo data into the result, as main's tests do.
 *
 * Exit 1 if any step fails or the two databases differ. Read-only with
 * respect to every real database: it never connects to one.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { GRANTS, PRELUDE, testDbScripts } from '../../supabase/tests/setup.mjs';
import { ROOT } from '../env.mjs';
import { reconciliationPlan, resolveLedger, UNRECORDED } from './migrations.mjs';

const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const FINGERPRINT = readFileSync(join(ROOT, 'scripts', 'dr', 'fingerprint.sql'), 'utf8');

/** The ledger table, as Supabase's CLI and MCP keep it. */
const LEDGER_TABLE = `
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text
);`;

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--ledger') options.ledger = argv[++i];
    else if (arg === '--statements') options.statements = argv[++i];
    else if (arg === '--fingerprint') options.fingerprint = argv[++i];
    else if (arg === '--keep-going') options.keepGoing = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!options.ledger) throw new Error('--ledger <file> is required');
  return options;
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const rowsOf = (parsed) => (Array.isArray(parsed) ? parsed : (parsed.migrations ?? parsed.result ?? parsed.rows ?? []));

async function freshDb() {
  const db = new PGlite({ extensions: { pgcrypto, unaccent, pg_trgm } });
  await db.exec(PRELUDE);
  await db.exec(LEDGER_TABLE);
  return db;
}

async function run(db, label, sql) {
  try {
    await db.exec(sql);
  } catch (error) {
    throw new Error(`${label}: ${error.message}`, { cause: error });
  }
}

/**
 * One step of the plan the way `apply` runs it: the adjustment before, the
 * file, the adjustment after, and the ledger row — together or not at all.
 */
export async function runStep(db, step, sql) {
  const statements = [step.before, sql, step.after].filter(Boolean);
  await db.exec('begin');
  try {
    for (const statement of statements) await db.exec(statement);
    await db.query('insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)', [
      step.stem.slice(0, 14),
      step.stem.slice(15),
      statements,
    ]);
    await db.exec('commit');
  } catch (error) {
    await db.exec('rollback');
    throw new Error(`${step.stem}: ${error.message}`, { cause: error });
  }
}

/**
 * Read under Supabase's search path. A definition names anything outside the
 * search path with its schema — an index over pg_trgm's operator class reads
 * `extensions.gin_trgm_ops` — and Supabase's roles search `"$user", public,
 * extensions`, so a fingerprint taken on production matches a rebuild only
 * when both are read the same way.
 */
export async function fingerprint(db) {
  const rows = await db.transaction(async (tx) => {
    await tx.exec('set local search_path = "$user", public, extensions');
    return (await tx.query(FINGERPRINT)).rows;
  });
  return new Map(rows.map((row) => [`${row.kind} ${row.name}`, row.hash]));
}

export function compare(left, right) {
  const onlyLeft = [...left.keys()].filter((key) => !right.has(key)).sort();
  const onlyRight = [...right.keys()].filter((key) => !left.has(key)).sort();
  const changed = [...left.keys()].filter((key) => right.has(key) && right.get(key) !== left.get(key)).sort();
  return { onlyLeft, onlyRight, changed, same: !onlyLeft.length && !onlyRight.length && !changed.length };
}

function printDiff(log, title, diff, leftName, rightName) {
  if (diff.same) {
    log(`  ${title}: identical`);
    return;
  }
  log(`  ${title}: DIFFERENT`);
  for (const key of diff.onlyLeft) log(`    only in ${leftName}: ${key}`);
  for (const key of diff.onlyRight) log(`    only in ${rightName}: ${key}`);
  for (const key of diff.changed) log(`    differs: ${key}`);
}

export const migrationFiles = () =>
  readdirSync(MIGRATIONS).filter((file) => /^\d{14}_[a-z0-9_]+\.sql$/.test(file)).sort();
const sqlOf = (stem) => readFileSync(join(MIGRATIONS, `${stem}.sql`), 'utf8');

/**
 * The database a ledger describes: every file it names, in its order (files
 * applied by hand at their place in file order), the API grants, and the
 * ledger rows themselves — so a tool reading this database's history sees what
 * it would see on the real one.
 */
export async function buildFromLedger({ ledgerRows, statements = null }) {
  const files = migrationFiles();
  const stems = files.map((file) => file.replace(/\.sql$/, ''));
  const stored = new Map((statements ?? []).map((row) => [String(row.version), row]));
  const db = await freshDb();
  const applied = new Set();
  const replayed = [];
  let fromStored = 0;

  const catchUpUnrecorded = async (through) => {
    for (const stem of UNRECORDED) {
      if (!applied.has(stem) && stems.includes(stem) && stem <= through) {
        await run(db, `${stem} (applied by hand)`, sqlOf(stem));
        applied.add(stem);
        replayed.push(`${stem} (by hand)`);
      }
    }
  };

  for (const { row, stem } of resolveLedger(ledgerRows, files)) {
    if (stem === undefined) throw new Error(`the ledger has ${row.version} ${row.name}, which no file accounts for (drift)`);
    if (stem === null) {
      // A historical entry with no file: the API grants, applied again below.
      await run(db, `${row.name} (grants)`, GRANTS);
      continue;
    }
    if (applied.has(stem)) continue; // one file recorded as several rows
    await catchUpUnrecorded(stem);
    const record = stored.get(String(row.version));
    const sql = record ? (Array.isArray(record.statements) ? record.statements.join(';\n') : String(record.statements)) : sqlOf(stem);
    if (record) fromStored += 1;
    await run(db, `${row.version} ${row.name} → ${stem}`, sql);
    applied.add(stem);
    replayed.push(stem);
  }
  await catchUpUnrecorded('99999999999999');
  await run(db, 'grants', GRANTS);

  for (const row of ledgerRows) {
    await db.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)', [
      String(row.version),
      String(row.name ?? ''),
    ]);
  }
  return { db, replayed, fromStored };
}

/** This checkout, built fresh in file order: what main is. */
export async function freshBuild() {
  const db = await freshDb();
  for (const script of testDbScripts({ seed: false })) {
    if (script.name === 'prelude') continue;
    await run(db, script.name, script.sql);
  }
  return db;
}

export async function rehearse({ ledgerRows, statements = null, productionFingerprint = null, keepGoing = false, log = console.log }) {
  const files = migrationFiles();

  // ---- 1. The database the ledger describes, in the order it ran ----------
  log('1. rebuilding the database the ledger describes, in its order');
  const { db: target, replayed, fromStored } = await buildFromLedger({ ledgerRows, statements });
  log(`   ${replayed.length} files replayed (${fromStored} from stored statements, ${replayed.length - fromStored} from files)`);

  const before = await fingerprint(target);
  let verified = null;
  if (productionFingerprint) {
    const real = new Map(productionFingerprint.map((row) => [`${row.kind} ${row.name}`, row.hash]));
    const diff = compare(real, before);
    log('2. the rebuild against the real database');
    printDiff(log, 'fingerprint', diff, 'the real database', 'the rebuild');
    verified = diff.same;
  } else {
    log('2. no --fingerprint given: the rebuild is not compared with the real database');
  }

  // ---- 3. The plan, run as `apply` will run it -----------------------------
  const plan = reconciliationPlan(ledgerRows, files);
  const pending = plan.steps.map((step) => step.stem);
  log(`3. applying the ${pending.length} pending file(s), each in its own transaction with its ledger row`);
  if (plan.ranAhead.length) log(`   (the database ran ${plan.ranAhead.length} file(s) ahead of main's order: ${plan.ranAhead.map((stem) => stem.slice(11, 14)).join(', ')})`);
  const failures = [];
  for (const step of plan.steps) {
    const adjusted = step.before || step.after ? ' (with its adjustment)' : '';
    try {
      await runStep(target, step, sqlOf(step.stem));
      log(`   ${step.stem}${adjusted} … ok`);
    } catch (error) {
      log(`   ${step.stem}${adjusted} … FAILED\n     ${error.message}`);
      failures.push({ stem: step.stem, message: error.message });
      if (!keepGoing) break; // `apply` stops at the first failure
    }
  }

  // ---- 4. The same thing, built fresh from this checkout -------------------
  log('4. building this checkout fresh, in file order');
  const fresh = await freshBuild();
  const reconciledPrint = await fingerprint(target);
  const freshPrint = await fingerprint(fresh);
  const diff = compare(freshPrint, reconciledPrint);
  printDiff(log, 'reconciled vs fresh', diff, 'the fresh build', 'the reconciled database');

  // ---- 5. The seed and demo data on the result -----------------------------
  let seeded = false;
  if (!failures.length) {
    log('5. loading the seed and the demo data into the reconciled database');
    try {
      for (const script of testDbScripts({ seed: true })) {
        if (['seed.sql', 'demo users', 'seed-demo.sql'].includes(script.name)) await run(target, script.name, script.sql);
      }
      seeded = true;
      log('   ok');
    } catch (error) {
      log(`   FAILED\n     ${error.message}`);
    }
  }

  await target.close();
  await fresh.close();

  return {
    replayed,
    fromStored,
    verified,
    plan,
    pending,
    failures,
    diff,
    seeded,
    ok: !failures.length && diff.same && seeded && verified !== false,
  };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const result = await rehearse({
    ledgerRows: rowsOf(readJson(options.ledger)),
    statements: options.statements ? rowsOf(readJson(options.statements)) : null,
    productionFingerprint: options.fingerprint ? rowsOf(readJson(options.fingerprint)) : null,
    keepGoing: options.keepGoing,
  });
  console.log(
    result.ok
      ? `\nrehearsal passed: the ${result.pending.length} pending migration(s) apply cleanly and the result is the database main builds${result.verified ? ', starting from a verified copy' : ' (starting point unverified)'}.`
      : '\nrehearsal FAILED — see above.',
  );
  process.exit(result.ok ? 0 : 1);
}
