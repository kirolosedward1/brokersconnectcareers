/**
 * A company in more than one place (migration 383): its admins keep up to
 * twenty branches, everybody reads them, and a listing names only a branch
 * of its own company.
 *
 * Run with: node supabase/tests/company-branches.test.mjs
 */
import { createTestDb, reporter, runner } from './setup.mjs';

const db = await createTestDb();
const report = reporter();
const as = runner(db);
const one = async (sql) => (await db.query(sql)).rows[0];

const OWNER = 'bdbdbdbd-1111-0000-0000-000000000001';
const RECRUITER = 'bdbdbdbd-1111-0000-0000-000000000002';
const OTHER = 'bdbdbdbd-1111-0000-0000-000000000003';
const COMPANY = 'bdbdbdbd-3333-0000-0000-000000000001';
const OTHER_CO = 'bdbdbdbd-3333-0000-0000-000000000002';

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
    ('${OWNER}', 'owner-b@demo.test', now(), now(), now()),
    ('${RECRUITER}', 'rec-b@demo.test', now(), now(), now()),
    ('${OTHER}', 'other-b@demo.test', now(), now(), now());
  insert into profiles (id, role, full_name, whatsapp_phone, approval_status) values
    ('${OWNER}', 'employer', 'المالك', '+201044430001', 'approved'),
    ('${RECRUITER}', 'employer', 'المجنّد', '+201044430002', 'approved'),
    ('${OTHER}', 'employer', 'آخر', '+201044430003', 'approved')
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
  update profiles set approval_status = 'approved' where id in ('${OWNER}', '${RECRUITER}', '${OTHER}');
  insert into companies (id, owner_id, name_ar, slug, verification_status) values
    ('${COMPANY}', '${OWNER}', 'شركة الفروع', 'branches-co', 'verified'),
    ('${OTHER_CO}', '${OTHER}', 'شركة أخرى', 'branches-other', 'verified');
  insert into company_members (company_id, user_id, role) values ('${COMPANY}', '${RECRUITER}', 'recruiter');
`);
const district = (await one(`select id from districts limit 1`)).id;
const add = (who, company, name) =>
  as(who, `insert into company_branches (company_id, name_ar, district_id) values ('${company}', '${name}', ${district}) returning id`);

report.section('kept by the company’s admins');
report.check('an admin adds a branch', (await add(OWNER, COMPANY, 'فرع التجمع')).rows.length === 1);
report.check('a recruiter does not', !(await add(RECRUITER, COMPANY, 'فرع')).ok);
report.check('nor another company', !(await add(OTHER, COMPANY, 'فرع')).ok);
await db.exec(`insert into company_branches (company_id, name_ar, district_id) values ('${COMPANY}', 'فرع التجمع', ${district}), ('${OTHER_CO}', 'فرع آخر', ${district})`);
const branch = (await one(`select id from company_branches where company_id = '${COMPANY}'`)).id;
const foreign = (await one(`select id from company_branches where company_id = '${OTHER_CO}'`)).id;

report.section('read by everyone');
await db.exec('begin; set local role anon;');
const anon = (await db.query(`select name_ar from company_branches where company_id = '${COMPANY}'`)).rows;
await db.exec('rollback');
report.check('a visitor reads the branches', anon.length === 1);

report.section('twenty at most');
await db.exec(`insert into company_branches (company_id, name_ar) select '${COMPANY}', 'فرع ' || n from generate_series(2, 20) n`);
const extra = await db.query(`insert into company_branches (company_id, name_ar) values ('${COMPANY}', 'فرع زائد')`).then(() => true, (e) => e.message);
report.check('a twenty-first is refused, named', /branch_cap/.test(String(extra)), String(extra));

report.section('a listing names its own company’s branch');
const job = (await one(`
  insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band,
                    district_id, commission_type, leads_source, description_ar, status, branch_id)
  values ('${COMPANY}', 'مستشار', 'branch-job', 'primary', 'full_time', 'junior_1_3',
          ${district}, 'none', 'company_provided', 'وصف', 'draft', ${branch})
  returning id`)).id;
report.check('its own branch is kept', (await one(`select branch_id from jobs where id = '${job}'`)).branch_id === branch);
const wrong = await db.query(`update jobs set branch_id = ${foreign} where id = '${job}'`).then(() => true, (e) => e.message);
report.check("another company's branch is refused", /branch_not_of_company/.test(String(wrong)), String(wrong));
await db.exec(`delete from company_branches where id = ${branch}`);
report.check('a branch removed leaves its listing without one', (await one(`select branch_id from jobs where id = '${job}'`)).branch_id === null);

process.exit(report.finish() ? 0 : 1);
