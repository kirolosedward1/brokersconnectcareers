/**
 * A company says when it hires (migration 378): a paused company takes no
 * new applications, whichever door they come through, until the day it
 * named has passed or it opens again; its number and hours keep their shape.
 *
 * Run with: node supabase/tests/company-hiring.test.mjs
 */
import { createTestDb, reporter, runner } from './setup.mjs';

const db = await createTestDb();
const report = reporter();
const as = runner(db);
const one = async (sql) => (await db.query(sql)).rows[0];

const OWNER = 'adadadad-1111-0000-0000-000000000001';
const CANDIDATE = 'adadadad-2222-0000-0000-000000000001';
const COMPANY = 'adadadad-3333-0000-0000-000000000001';

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
    ('${OWNER}', 'owner-h@demo.test', now(), now(), now()),
    ('${CANDIDATE}', 'cand-h@demo.test', now(), now(), now());
  insert into profiles (id, role, full_name, whatsapp_phone, approval_status) values
    ('${OWNER}', 'employer', 'المالك', '+201055520001', 'approved'),
    ('${CANDIDATE}', 'candidate', 'سارة', '+201055520002', 'approved')
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
  update profiles set approval_status = 'approved' where id in ('${OWNER}', '${CANDIDATE}');
  insert into companies (id, owner_id, name_ar, slug, verification_status) values
    ('${COMPANY}', '${OWNER}', 'شركة التوظيف', 'hiring-co', 'verified');
`);
const job = (await one(`
  insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band,
                    district_id, commission_type, leads_source, description_ar, status, published_at, expires_at)
  values ('${COMPANY}', 'مستشار', 'hiring-job', 'primary', 'full_time', 'junior_1_3',
          (select id from districts limit 1), 'none', 'company_provided', 'وصف', 'active', now(), now() + interval '30 days')
  returning id`)).id;
const apply = () =>
  as(CANDIDATE, `insert into applications (job_id, candidate_id, experience_band) values ('${job}', '${CANDIDATE}', 'junior_1_3') returning id`);

report.section('open by default');
report.check('every company starts open', (await one(`select hiring_status from companies where id = '${COMPANY}'`)).hiring_status === 'open');
const opened = await apply();
report.check('and an application goes through', opened.ok && opened.rows.length === 1, opened.error);

report.section('paused');
const paused = await as(OWNER, `update companies set hiring_status = 'paused' where id = '${COMPANY}' returning id`);
report.check('the owner pauses hiring', paused.ok && paused.rows.length === 1, paused.error);
await db.exec(`update companies set hiring_status = 'paused' where id = '${COMPANY}'`);
const refused = await apply();
report.check("a new application is refused, named 'company_paused'", !refused.ok && /company_paused/.test(refused.error ?? ''), refused.error);
report.check('company_is_hiring says no', (await one(`select public.company_is_hiring('${COMPANY}') as ok`)).ok === false);

report.section('until a day');
await db.exec(`update companies set paused_until = (now() at time zone 'Africa/Cairo')::date where id = '${COMPANY}'`);
report.check('still paused on the day it names', (await one(`select public.company_is_hiring('${COMPANY}') as ok`)).ok === false);
await db.exec(`update companies set paused_until = (now() at time zone 'Africa/Cairo')::date - 1 where id = '${COMPANY}'`);
report.check('open again once that day has passed, with nothing run', (await one(`select public.company_is_hiring('${COMPANY}') as ok`)).ok === true);
const after = await apply();
report.check('and applications go through', after.ok, after.error);

report.section('the number and the hours keep their shape');
const badPhone = await db.query(`update companies set contact_whatsapp = '0100' where id = '${COMPANY}'`).then(() => true, () => false);
report.check('a number that is not international is refused', badPhone === false);
const goodPhone = await db.query(`update companies set contact_whatsapp = '+201055520099' where id = '${COMPANY}'`).then(() => true, () => false);
report.check('an international one is kept', goodPhone === true);
const hours = await db.query(`update companies set reply_hours = '{"days":[0,1,2,3,4],"from":"10:00","to":"18:00"}' where id = '${COMPANY}'`).then(() => true, (e) => e.message);
report.check('hours as days, from and to are kept', hours === true, hours);
const backwards = await db.query(`update companies set reply_hours = '{"days":[0],"from":"18:00","to":"10:00"}' where id = '${COMPANY}'`).then(() => true, () => false);
report.check('hours that end before they start are refused', backwards === false);
const noDays = await db.query(`update companies set reply_hours = '{"days":[],"from":"10:00","to":"18:00"}' where id = '${COMPANY}'`).then(() => true, () => false);
report.check('and so are hours on no day', noDays === false);

report.section('the public reads it');
await db.exec('begin; set local role anon;');
const anon = (await db.query(`select hiring_status, contact_whatsapp, reply_hours, public.company_is_hiring(id) as hiring from companies where id = '${COMPANY}'`)).rows[0];
await db.exec('rollback');
report.check('a visitor reads the status, the number and the hours', anon?.contact_whatsapp === '+201055520099' && anon?.reply_hours?.from === '10:00');

process.exit(report.finish() ? 0 : 1);
