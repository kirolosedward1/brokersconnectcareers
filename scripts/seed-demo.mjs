/**
 * Creates the four demo accounts and their application rows.
 *
 *   node scripts/seed-demo.mjs
 *
 * Users are created through the Auth admin API rather than by inserting into
 * auth.users: GoTrue needs a matching auth.identities row whose columns move
 * between versions, and a hand-rolled insert yields an account that cannot sign
 * in. The API does it correctly whatever version the project runs.
 *
 * Safe to re-run — existing users are reused and the SQL half is idempotent.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { loadEnv, require_, ROOT } from './env.mjs';

loadEnv();

const supabaseUrl = require_('NEXT_PUBLIC_SUPABASE_URL', 'Project Settings → API → Project URL');
const serviceKey = require_('SUPABASE_SERVICE_ROLE_KEY', 'Project Settings → API → service_role');
const databaseUrl = require_(
  'DATABASE_URL',
  'Project Settings → Database → Connection string → URI (direct, not the pooler)',
);

const PASSWORD = 'password123';

const DEMO = [
  { key: 'employer1', email: 'employer1@demo.test', name: 'محمد عبد الرحمن' },
  { key: 'employer2', email: 'employer2@demo.test', name: 'سارة فتحي' },
  { key: 'employer3', email: 'employer3@demo.test', name: 'كريم الشناوي' },
  { key: 'employer4', email: 'employer4@demo.test', name: 'داليا مرسي' },
  { key: 'employer5', email: 'employer5@demo.test', name: 'أحمد بدوي' },
  { key: 'employer6', email: 'employer6@demo.test', name: 'نهى السيد' },
  { key: 'employer7', email: 'employer7@demo.test', name: 'طارق منير' },
  { key: 'candidate1', email: 'candidate1@demo.test', name: 'أحمد محمود' },
  { key: 'candidate2', email: 'candidate2@demo.test', name: 'منة الله شريف' },
  { key: 'candidate3', email: 'candidate3@demo.test', name: 'يوسف عادل' },
  { key: 'candidate4', email: 'candidate4@demo.test', name: 'هبة رمضان' },
  { key: 'candidate5', email: 'candidate5@demo.test', name: 'مصطفى الجندي' },
  { key: 'candidate6', email: 'candidate6@demo.test', name: 'رنا حسام' },
  { key: 'candidate7', email: 'candidate7@demo.test', name: 'عمرو صلاح' },
  { key: 'admin', email: 'admin@demo.test', name: 'المشرف' },
];

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function findUser(email) {
  const url = new URL('/auth/v1/admin/users', supabaseUrl);
  url.searchParams.set('filter', email);
  const response = await fetch(url, { headers });
  if (!response.ok) return null;
  const body = await response.json();
  return (body.users ?? []).find((user) => user.email === email) ?? null;
}

async function createUser({ email, name }) {
  const response = await fetch(new URL('/auth/v1/admin/users', supabaseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: name },
    }),
  });

  if (response.ok) return response.json();

  // Already registered — fall back to looking it up.
  const existing = await findUser(email);
  if (existing) return existing;

  console.error(`Could not create ${email}: ${response.status} ${await response.text()}`);
  process.exit(1);
}

console.log('demo accounts');
const ids = {};
for (const user of DEMO) {
  const existing = await findUser(user.email);
  const record = existing ?? (await createUser(user));
  ids[user.key] = record.id;
  console.log(`  ${existing ? 'found  ' : 'created'} ${user.email}`);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('supabase.') ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

console.log('\ndemo data');
try {
  await client.query('begin');
  // seed-demo.sql reads this map instead of hardcoding ids.
  await client.query(`select set_config('demo.users', $1, false)`, [JSON.stringify(ids)]);
  await client.query(readFileSync(join(ROOT, 'supabase', 'seed-demo.sql'), 'utf8'));
  await client.query('commit');
  console.log('  seed-demo.sql … ok');
} catch (error) {
  await client.query('rollback').catch(() => {});
  console.error(`  seed-demo.sql … FAILED\n\n${error.message}`);
  if (error.hint) console.error(`hint: ${error.hint}`);
  await client.end();
  process.exit(1);
}

const { rows } = await client.query(`
  select (select count(*) from profiles) as profiles,
         (select count(*) from companies) as companies,
         (select count(*) from jobs where status = 'active') as active_jobs,
         (select count(*) from agent_profiles) as agents,
         (select count(*) from applications) as applications
`);
await client.end();

console.log('\n', rows[0]);
console.log(`\nsign in with any of the demo emails, password: ${PASSWORD}`);
