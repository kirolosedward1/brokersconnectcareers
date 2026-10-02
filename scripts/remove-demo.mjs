/**
 * Removes the seeded demo data from a project: the @demo.test accounts, the
 * companies they own, those companies' listings and every application to them
 * (supabase/seed-demo.sql made them for local and staging databases;
 * docs/app-store.md, "Before the first submission").
 *
 *   pnpm remove-demo                               what it would remove; reads only
 *   pnpm remove-demo --execute --confirm <ref>     removes it
 *
 * Deleting the users in the Supabase dashboard does not work: a profile that
 * owns a company is never deleted from under it, so every demo employer's
 * deletion fails. supabase/remove-demo.sql takes the companies away first, in
 * one transaction (tested in supabase/tests/remove-demo.test.mjs), and this
 * then deletes the users through the Auth admin API, which takes their
 * profiles and what is only theirs.
 *
 * Needs, as for `pnpm db:apply`: NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY and TARGET_DATABASE_URL, the same project's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv, require_, ROOT } from './env.mjs';
import { parseArgs, projectRef } from './review-accounts.mjs';

const DEMO_DOMAIN = '@demo.test';

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.remove) {
    console.error('Unknown argument: --remove (this script only removes)');
    process.exit(1);
  }
  const supabaseUrl = require_('NEXT_PUBLIC_SUPABASE_URL', 'Project Settings → API → Project URL');
  const serviceKey = require_('SUPABASE_SERVICE_ROLE_KEY', 'Project Settings → API → service_role');
  const databaseUrl = require_('TARGET_DATABASE_URL', 'the session pooler URI, as for pnpm db:apply');

  const ref = projectRef(supabaseUrl);
  if (/^[a-z0-9]{20}$/.test(ref) && !databaseUrl.includes(ref)) {
    console.error(`TARGET_DATABASE_URL is not ${ref}'s database.`);
    process.exit(1);
  }
  if (args.execute && args.confirm !== ref) {
    console.error(`This deletes from ${ref}. To go ahead, add --confirm ${ref}.`);
    process.exit(1);
  }

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const call = async (path, method = 'GET') => {
    const response = await fetch(new URL(path, supabaseUrl), { method, headers });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  const demoUsers = [];
  for (let page = 1; ; page += 1) {
    const { users = [] } = await call(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    demoUsers.push(...users.filter((user) => user.email?.toLowerCase().endsWith(DEMO_DOMAIN)));
    if (users.length < 1000) break;
  }

  const pg = (await import('pg')).default;
  const db = new pg.Client({ connectionString: databaseUrl });
  db.on('notice', (notice) => console.log(`  ${notice.message}`));
  await db.connect();
  const sql = readFileSync(join(ROOT, 'supabase', 'remove-demo.sql'), 'utf8');
  try {
    console.log(`Project ${ref}:`);
    await db.query('begin');
    try {
      await db.query(`select set_config('demo.dry_run', $1, true)`, [args.execute ? 'off' : 'on']);
      await db.query(sql);
      await db.query(args.execute ? 'commit' : 'rollback');
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
    if (!args.execute) {
      console.log(`\nNothing was changed. To remove it: --execute --confirm ${ref}`);
      return;
    }
    for (const user of demoUsers) await call(`/auth/v1/admin/users/${user.id}`, 'DELETE');
    console.log(`\nRemoved the demo companies, their listings and applications, and ${demoUsers.length} demo accounts.`);
  } finally {
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
