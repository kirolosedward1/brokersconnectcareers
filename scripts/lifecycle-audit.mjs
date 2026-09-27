/**
 * What is broken in the data, read-only.
 *
 *   pnpm lifecycle:audit            report only
 *   pnpm lifecycle:audit --repair   report, then show what the safe repairs would do
 *   pnpm lifecycle:audit --apply    report, then apply the safe repairs
 *
 * Reads over DATABASE_URL (the direct connection, as db:push uses). The
 * report is lifecycle_integrity_report() from migration 204 and never writes.
 * --apply runs repair_lifecycle_integrity(true), which only fixes what needs
 * no judgement about a person — a missing owner membership, a stale expiry
 * label, a missing history row — and only *queues* unreferenced files, which
 * still wait out their grace period and are re-checked before any deletion.
 * Everything else it finds is for a person to decide.
 *
 * Output is ids and counts, never names, emails or file contents.
 */
import pg from 'pg';
import { loadEnv } from './env.mjs';

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set — Supabase → Project Settings → Database → Connection string (URI, direct).');
  process.exit(1);
}

const repair = process.argv.includes('--repair') || process.argv.includes('--apply');
const apply = process.argv.includes('--apply');

const client = new pg.Client({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
await client.connect();

try {
  const { rows } = await client.query('select * from public.lifecycle_integrity_report()');
  const width = Math.max(...rows.map((r) => r.check_name.length));
  let problems = 0;

  console.log('lifecycle integrity');
  for (const row of rows) {
    const found = Number(row.found);
    const mark = found === 0 ? '✓' : row.severity === 'info' ? '·' : '✗';
    if (found > 0 && row.severity !== 'info') problems += 1;
    const sample = found > 0 ? `  e.g. ${row.sample.join(', ')}` : '';
    console.log(
      `  ${mark} ${row.check_name.padEnd(width)}  ${String(found).padStart(5)}  ${row.severity}${row.repairable ? ', repairable' : ''}${sample}`,
    );
  }

  if (repair) {
    console.log(apply ? '\nrepairs (applied)' : '\nrepairs (dry run — pass --apply to perform)');
    const { rows: repairs } = await client.query('select * from public.repair_lifecycle_integrity($1)', [apply]);
    for (const r of repairs) console.log(`  ${r.repair.padEnd(34)} ${String(r.affected).padStart(5)}`);
  }

  process.exitCode = problems > 0 ? 1 : 0;
} finally {
  await client.end();
}
