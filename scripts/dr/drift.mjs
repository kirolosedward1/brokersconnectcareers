/**
 * Does the database match what the migrations in git would build?
 *
 *   TARGET_DATABASE_URL='postgresql://...' node scripts/dr/drift.mjs
 *
 * Rebuilds the schema from supabase/migrations in-process (PGlite, as
 * `pnpm test:db` does) and compares it, object by object, with the target
 * using scripts/dr/fingerprint.sql. Read-only against the target.
 *
 * This is what makes "rebuild the schema from git, then load the data" a valid
 * recovery path. Run it after every production migration: drift found then is
 * a five-minute fix; drift found during a restore is a platform that comes back
 * subtly different. Without TARGET_DATABASE_URL it prints the rebuild's
 * per-kind summary, which can be compared by eye with the same query run in
 * the Supabase SQL editor.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createTestDb } from '../../supabase/tests/setup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FINGERPRINT = readFileSync(join(HERE, 'fingerprint.sql'), 'utf8');

const toMap = (rows) => new Map(rows.map((r) => [`${r.kind}\t${r.name}`, r.hash]));
function summary(map) {
  const kinds = {};
  for (const key of map.keys()) {
    const kind = key.split('\t')[0];
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  return kinds;
}

const rebuild = await createTestDb({ seed: false });
const expected = toMap((await rebuild.query(FINGERPRINT)).rows);
console.log('rebuilt from migrations:', summary(expected));

const url = process.env.TARGET_DATABASE_URL;
if (!url) process.exit(0);

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes('supabase.') ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
const actual = toMap((await client.query(FINGERPRINT)).rows);
await client.end();
console.log('target:                 ', summary(actual));

const onlyGit = [...expected.keys()].filter((k) => !actual.has(k));
const onlyTarget = [...actual.keys()].filter((k) => !expected.has(k));
const differ = [...expected.keys()].filter((k) => actual.has(k) && actual.get(k) !== expected.get(k));

const show = (title, keys) => keys.length && console.log(`\n${title}:\n  ${keys.map((k) => k.replace('\t', ' ')).join('\n  ')}`);
show('in git, missing from target', onlyGit);
show('in target, not in any migration', onlyTarget);
show('defined differently', differ);

const drift = onlyGit.length + onlyTarget.length + differ.length;
console.log(drift ? `\n${drift} object(s) drifted.` : '\nno drift: the target is what git builds.');
process.exit(drift ? 1 : 0);
