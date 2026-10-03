/**
 * Removing the seeded demo data (supabase/remove-demo.sql), on the real
 * migrations with the real demo seed. Run with: pnpm test:remove-demo
 * (also part of pnpm test:db)
 *
 * What it must make possible: deleting the @demo.test users, which fails
 * while a demo employer still owns a company. What it must not touch: anybody
 * else's account, company or listing. What it must refuse: a demo company
 * with a real member.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb, reporter } from './setup.mjs';

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'remove-demo.sql'), 'utf8');

const report = reporter();
const db = await createTestDb();
const one = async (sql) => (await db.query(sql)).rows[0];
const run = async (dryRun) => {
  try {
    await db.exec(`select set_config('demo.dry_run', '${dryRun ? 'on' : 'off'}', false);`);
    await db.exec(SQL);
    return null;
  } catch (error) {
    return error.message;
  }
};

// Somebody real: a candidate who applied to a demo listing, and an employer
// with a company and a listing of their own that a demo candidate applied to.
const REAL_CANDIDATE = 'b2b2b2b2-0000-4000-8000-000000000001';
const REAL_EMPLOYER = 'b2b2b2b2-0000-4000-8000-000000000002';
const REAL_COMPANY = 'b2b2b2b2-0000-4000-8000-0000000000c0';
await db.exec(`
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at) values
    ('${REAL_CANDIDATE}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'someone@example.com', now(), now(), now()),
    ('${REAL_EMPLOYER}',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hiring@example.com', now(), now(), now());
  insert into profiles (id, role, full_name, whatsapp_phone, locale) values
    ('${REAL_CANDIDATE}', 'candidate', 'مرشح حقيقي', '+201001112233', 'ar'),
    ('${REAL_EMPLOYER}',  'employer',  'صاحب عمل حقيقي', '+201004445566', 'ar');
  update profiles set approval_status = 'approved', approved_at = now() where id = '${REAL_EMPLOYER}';
  insert into companies (id, owner_id, name_ar, slug, headcount_band, verification_status)
    values ('${REAL_COMPANY}', '${REAL_EMPLOYER}', 'شركة حقيقية', 'real-company-test', '1_10', 'unverified');
  insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band, seats, district_id,
                    commission_type, leads_source, description_ar, status)
    select '${REAL_COMPANY}', 'وظيفة حقيقية', 'real-job-test', 'primary', 'full_time', 'junior_1_3', 1, id,
           'none', 'company_provided', 'وصف وظيفة حقيقية للتجربة.', 'active'
      from districts where slug = 'new-cairo';
  insert into applications (job_id, candidate_id, status, experience_band)
    select j.id, '${REAL_CANDIDATE}', 'new', 'junior_1_3' from jobs j
      join companies c on c.id = j.company_id
      join auth.users u on u.id = c.owner_id
     where u.email like '%@demo.test' and j.status = 'active'
     order by j.slug limit 1;
  insert into applications (job_id, candidate_id, status, experience_band)
    select j.id, u.id, 'new', 'junior_1_3' from jobs j, auth.users u
     where j.slug = 'real-job-test' and u.email = 'candidate1@demo.test';
`);

const counts = () =>
  one(`
    select
      (select count(*)::int from companies c join auth.users u on u.id = c.owner_id where u.email like '%@demo.test') as demo_companies,
      (select count(*)::int from jobs j join companies c on c.id = j.company_id join auth.users u on u.id = c.owner_id
         where u.email like '%@demo.test') as demo_jobs,
      (select count(*)::int from applications where candidate_id = '${REAL_CANDIDATE}') as real_applications,
      (select count(*)::int from companies where id = '${REAL_COMPANY}') as real_company,
      (select count(*)::int from jobs where slug = 'real-job-test') as real_job,
      (select count(*)::int from applications a join jobs j on j.id = a.job_id where j.slug = 'real-job-test') as real_job_applications,
      (select count(*)::int from profiles p join auth.users u on u.id = p.id where u.email like '%@demo.test') as demo_profiles,
      (select count(*)::int from profiles where id in ('${REAL_CANDIDATE}', '${REAL_EMPLOYER}')) as real_profiles
  `);

const before = await counts();
report.section('what the demo seed left');
report.check(
  'demo companies with listings, and a real candidate who applied to one',
  before.demo_companies === 7 && before.demo_jobs > 0 && before.real_applications === 1 && before.demo_profiles === 15,
  JSON.stringify(before),
);

const blocked = await db
  .exec(`begin; delete from auth.users where email = 'employer1@demo.test';`)
  .then(() => null, (error) => error.message);
await db.exec('rollback');
report.check("a demo employer's user cannot be deleted while it owns a company", blocked !== null, blocked ?? 'it was deleted');

// ---------------------------------------------------------------------------
report.section('refusals');

// A real employer made a member of a demo company (rolled back afterwards).
const COLLEAGUE = 'b2b2b2b2-0000-4000-8000-000000000003';
await db.exec('begin');
let outsider = null;
let keptForOutsider = null;
try {
  await db.exec(`
    insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at) values
      ('${COLLEAGUE}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'colleague@example.com', now(), now(), now());
    insert into profiles (id, role, full_name, whatsapp_phone, locale) values
      ('${COLLEAGUE}', 'employer', 'زميل حقيقي', '+201007778899', 'ar');
    insert into company_members (company_id, user_id)
    select c.id, '${COLLEAGUE}' from companies c join auth.users u on u.id = c.owner_id
     where u.email = 'employer1@demo.test';`);
  // The refusal aborts the transaction it raises in: read the counts after
  // going back to before it.
  await db.exec('savepoint before_removal');
  outsider = await run(false);
  await db.exec('rollback to savepoint before_removal');
  keptForOutsider = await counts();
} catch (error) {
  outsider = `setup failed: ${error.message}`;
}
await db.exec('rollback');
report.check('refuses while a demo company has a member who is not a demo account', /not demo accounts/.test(outsider ?? ''), outsider);
report.check('and removes nothing', keptForOutsider?.demo_companies === 7, JSON.stringify(keptForOutsider));

report.check('a dry run runs', (await run(true)) === null);
report.check('and changes nothing', JSON.stringify(await counts()) === JSON.stringify(before));

// ---------------------------------------------------------------------------
report.section('the removal');

const removal = await run(false);
report.check('runs', removal === null, removal);
const after = await counts();
report.check('no demo company or listing is left', after.demo_companies === 0 && after.demo_jobs === 0, JSON.stringify(after));
report.check("the real candidate's application to a demo listing went with it", after.real_applications === 0, JSON.stringify(after));
report.check(
  "the real company, its listing and the application to it are untouched",
  after.real_company === 1 && after.real_job === 1 && after.real_job_applications === 1,
  JSON.stringify(after),
);

const deleted = await db
  .exec(`delete from auth.users where email like '%@demo.test';`)
  .then(() => null, (error) => error.message);
report.check('then the demo users can be deleted', deleted === null, deleted);
const end = await counts();
report.check(
  'which takes their profiles, and the demo application to the real listing, and nobody else',
  end.demo_profiles === 0 && end.real_profiles === 2 && end.real_job_applications === 0 && end.real_company === 1,
  JSON.stringify(end),
);

report.check('a second run finds nothing to do', (await run(false)) === null && (await counts()).demo_companies === 0);

await db.close();
process.exit(report.finish() ? 0 : 1);
