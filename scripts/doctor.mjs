/**
 * Preflight for a Supabase-backed localhost.
 *
 *   node scripts/doctor.mjs
 *
 * Checks the pieces in the order they break: env values, then the REST API as
 * an anonymous visitor (which also proves the grants and RLS are right), then
 * the schema, then storage, then auth.
 */
import { loadEnv } from './env.mjs';

loadEnv();

let failed = 0;

function ok(label, detail = '') {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}
function bad(label, fix) {
  failed += 1;
  console.log(`  ✗ ${label}`);
  if (fix) console.log(`      ${fix}`);
}

console.log('environment');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

const placeholder = (v) =>
  !v || v.startsWith('placeholder') || v === 'PASTE-HERE' || v.includes('127.0.0.1');

if (placeholder(url)) bad('NEXT_PUBLIC_SUPABASE_URL', 'Project Settings → API → Project URL');
else ok('NEXT_PUBLIC_SUPABASE_URL', url);

if (placeholder(anon)) bad('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Project Settings → API → anon public');
else ok('NEXT_PUBLIC_SUPABASE_ANON_KEY', `${anon.slice(0, 12)}…`);

if (placeholder(service)) bad('SUPABASE_SERVICE_ROLE_KEY', 'Project Settings → API → service_role');
else ok('SUPABASE_SERVICE_ROLE_KEY', `${service.slice(0, 12)}…`);

if (failed) {
  console.log('\nFill these into .env.local first.');
  process.exit(1);
}

const rest = (path, key = anon) =>
  fetch(new URL(`/rest/v1/${path}`, url), {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });

console.log('\nreachability');
try {
  // Probe a real table, not the PostgREST root: the root returns 401 under the
  // sb_publishable key format even when every table read works fine.
  const response = await rest('governorates?select=id&limit=1');
  if (response.ok) ok('REST API responds', `HTTP ${response.status}`);
  else bad(`REST API returned HTTP ${response.status}`, 'Is the project paused, or the key wrong?');
} catch (error) {
  bad('REST API unreachable', error.message);
  console.log('\nStopping — nothing else can be checked.');
  process.exit(1);
}

// What to run when the schema or its rows are short. Not db:push:url on a
// database with data: it re-runs every migration, then the seed and the grants
// (docs/disaster-recovery.md). db:apply reads the database's own ledger and
// applies only what is missing — migration 342 brings the search aliases.
const APPLY =
  'Run: pnpm db:apply — it lists what this database is missing; again with --execute to apply.' +
  ' (A new, empty project only: pnpm db:push:url.)';

console.log('\nschema');
for (const [table, minimum] of [
  ['governorates', 7],
  ['districts', 21],
  ['developers', 17],
  // Migration 68 creates the table; seed.sql fills it, and migration 342 on a
  // database seeded before it. Without the rows search still works, but
  // «القاهرة الجديدة» finds nothing.
  ['search_aliases', 25],
]) {
  const response = await rest(`${table}?select=id`);
  if (!response.ok) {
    bad(`${table} not readable (HTTP ${response.status})`, APPLY);
    continue;
  }
  const rows = await response.json();
  if (rows.length >= minimum) ok(`${table}`, `${rows.length} rows`);
  else bad(`${table} has ${rows.length} rows, expected ${minimum}`, APPLY);
}

// An anonymous read of jobs proves the public board policy is in place.
const jobs = await rest('jobs?select=id,status&status=eq.active');
if (jobs.ok) {
  const rows = await jobs.json();
  if (rows.length) ok('active jobs visible anonymously', `${rows.length}`);
  else
    console.log(
      '  · no active jobs yet — the board will render empty.\n' +
        '      Run: node scripts/seed-demo.mjs',
    );
} else {
  bad(`jobs not readable (HTTP ${jobs.status})`, APPLY);
}

// Every live listing needs a search document or the keyword search skips it.
// The triggers write them; this catches a database where the backfill in
// migration 68 never ran.
const [live, documents] = await Promise.all([
  rest('jobs?select=id&status=eq.active'),
  rest('job_search_documents?select=job_id'),
]);
if (live.ok && documents.ok) {
  const liveIds = (await live.json()).map((row) => row.id);
  const indexed = new Set((await documents.json()).map((row) => row.job_id));
  const missing = liveIds.filter((id) => !indexed.has(id));
  if (!missing.length) ok('every live listing is searchable', `${liveIds.length}`);
  else bad(`${missing.length} live listings have no search document`, APPLY);
} else if (!documents.ok) {
  bad(`job_search_documents not readable (HTTP ${documents.status})`, APPLY);
}

// Public profiles are meant to be readable anonymously; gated ones are not.
// Asserting "zero rows" would be wrong the moment a public profile exists.
const gated = await rest('agent_profiles?select=slug,visibility');
if (gated.ok) {
  const rows = await gated.json();
  const leaked = rows.filter((row) => row.visibility !== 'public');
  if (leaked.length === 0) {
    ok('the agent gate holds', `${rows.length} public profile(s) visible, 0 gated`);
  } else {
    bad(
      `${leaked.length} non-public agent profile(s) readable anonymously`,
      'Check migration 04 applied',
    );
  }
}

console.log('\nstorage');
try {
  const response = await fetch(new URL('/storage/v1/bucket', url), {
    headers: { apikey: service, Authorization: `Bearer ${service}` },
  });
  if (response.ok) {
    const buckets = (await response.json()).map((b) => b.id);
    for (const wanted of ['company-logos', 'company-documents', 'cvs']) {
      if (buckets.includes(wanted)) ok(`bucket ${wanted}`);
      else bad(`bucket ${wanted} missing`, 'Migration 06 did not apply');
    }
  } else {
    bad(`storage returned HTTP ${response.status}`);
  }
} catch (error) {
  bad('storage unreachable', error.message);
}

console.log('\nauth');
try {
  const response = await fetch(new URL('/auth/v1/settings', url), { headers: { apikey: anon } });
  if (response.ok) {
    const settings = await response.json();
    ok('auth responds');
    if (settings.external?.google) ok('Google provider enabled');
    else console.log('  · Google sign-in is off — email/password still works.');
  } else {
    bad(`auth returned HTTP ${response.status}`);
  }
} catch (error) {
  bad('auth unreachable', error.message);
}

console.log(failed === 0 ? '\nAll good — restart the dev server.' : `\n${failed} problem(s) above.`);
process.exit(failed === 0 ? 0 : 1);
