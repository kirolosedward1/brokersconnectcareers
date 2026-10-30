/**
 * A company sets its own rules (migration 380): a decline or a live
 * listing's pay change by a member who is not an admin waits for an admin;
 * a team that must use a second factor reads nothing of the company without
 * one; only admins open CVs when the company says so.
 *
 * Run with: node supabase/tests/company-rules.test.mjs
 */
import { createTestDb, reporter } from './setup.mjs';

const db = await createTestDb();
const report = reporter();
const one = async (sql) => (await db.query(sql)).rows[0];

// As the website's session would, at a given assurance level; rolled back.
async function as(userId, sql, aal = 'aal1') {
  await db.exec('begin');
  try {
    await db.exec('set local role authenticated;');
    await db.exec(`set local request.jwt.claim.sub = '${userId}';`);
    await db.exec(`set local request.jwt.claims = '{"role":"authenticated","sub":"${userId}","aal":"${aal}"}';`);
    const result = await db.query(sql);
    await db.exec('rollback');
    return { ok: true, rows: result.rows };
  } catch (error) {
    await db.exec('rollback');
    return { ok: false, error: error.message, rows: [] };
  }
}

const OWNER = 'afafafaf-1111-0000-0000-000000000001';
const RECRUITER = 'afafafaf-1111-0000-0000-000000000002';
const CANDIDATE = 'afafafaf-2222-0000-0000-000000000001';
const COMPANY = 'afafafaf-3333-0000-0000-000000000001';

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
    ('${OWNER}', 'owner-r@demo.test', now(), now(), now()),
    ('${RECRUITER}', 'rec-r@demo.test', now(), now(), now()),
    ('${CANDIDATE}', 'cand-r@demo.test', now(), now(), now());
  insert into profiles (id, role, full_name, whatsapp_phone, approval_status) values
    ('${OWNER}', 'employer', 'المالك', '+201055540001', 'approved'),
    ('${RECRUITER}', 'employer', 'المجنّد', '+201055540002', 'approved'),
    ('${CANDIDATE}', 'candidate', 'سارة', '+201055540003', 'approved')
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
  update profiles set approval_status = 'approved' where id in ('${OWNER}', '${RECRUITER}', '${CANDIDATE}');
  insert into companies (id, owner_id, name_ar, slug, verification_status) values ('${COMPANY}', '${OWNER}', 'شركة القواعد', 'rules-co', 'verified');
  insert into company_members (company_id, user_id, role) values ('${COMPANY}', '${RECRUITER}', 'recruiter');
`);
const job = (await one(`
  insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band, basic_salary_min,
                    district_id, commission_type, leads_source, description_ar, status, published_at, expires_at)
  values ('${COMPANY}', 'مستشار', 'rules-job', 'primary', 'full_time', 'junior_1_3', 8000,
          (select id from districts limit 1), 'none', 'company_provided', 'وصف', 'active', now(), now() + interval '30 days')
  returning id`)).id;
const application = (await one(`insert into applications (job_id, candidate_id, experience_band, status) values ('${job}', '${CANDIDATE}', 'junior_1_3', 'shortlisted') returning id`)).id;
const decline = `update applications set status = 'rejected' where id = '${application}' returning id`;
const payRise = `update jobs set basic_salary_min = 9000 where id = '${job}' returning id`;

report.section('no rules, nothing changes');
report.check('a recruiter declines', (await as(RECRUITER, decline)).rows.length === 1);
report.check('and changes a live listing’s pay', (await as(RECRUITER, payRise)).rows.length === 1);

report.section('the rules are the admins’');
const byRecruiter = await as(RECRUITER, `insert into company_policies (company_id, approve_decline) values ('${COMPANY}', true)`);
report.check('a recruiter cannot set them', !byRecruiter.ok);
const mfaAtAal1 = await as(OWNER, `insert into company_policies (company_id, require_mfa) values ('${COMPANY}', true)`);
report.check('an admin cannot require a second factor without having used one', !mfaAtAal1.ok && /mfa_required_to_require/.test(mfaAtAal1.error));
const set = await as(OWNER, `insert into company_policies (company_id, approve_decline, approve_pay_change, cv_admins_only) values ('${COMPANY}', true, true, true) returning company_id`);
report.check('an admin sets them', set.ok, set.error);
await db.exec(`insert into company_policies (company_id, approve_decline, approve_pay_change, cv_admins_only) values ('${COMPANY}', true, true, true)`);
const read = await as(RECRUITER, `select * from public.company_rules()`);
report.check('every member reads them', read.rows[0]?.approve_decline === true && read.rows[0]?.mfa_satisfied === true, read.error);

report.section('a decline and a pay change wait for an admin');
const waits = await as(RECRUITER, decline);
report.check("a recruiter's decline is refused, named", !waits.ok && /decline_needs_approval/.test(waits.error), waits.error);
report.check('an admin declines', (await as(OWNER, decline)).rows.length === 1);
report.check('a recruiter moves to any other stage as before', (await as(RECRUITER, `update applications set status = 'interview' where id = '${application}' returning id`)).rows.length === 1);
const payWaits = await as(RECRUITER, payRise);
report.check("a recruiter's pay change on a live listing is refused, named", !payWaits.ok && /pay_change_needs_approval/.test(payWaits.error), payWaits.error);
report.check('the rest of an edit is not', (await as(RECRUITER, `update jobs set seats = 3 where id = '${job}' returning id`)).rows.length === 1);
report.check('an admin changes the pay', (await as(OWNER, payRise)).rows.length === 1);

report.section('the requests');
const asked = await as(RECRUITER, `insert into company_approval_requests (company_id, kind, subject_id, payload, requested_by) values ('${COMPANY}', 'decline', '${application}', '{"from":"shortlisted"}', '${RECRUITER}') returning id`);
report.check('a member asks', asked.ok, asked.error);
await db.exec(`insert into company_approval_requests (id, company_id, kind, subject_id, payload, requested_by) values ('afafafaf-4444-0000-0000-000000000001', '${COMPANY}', 'decline', '${application}', '{"from":"shortlisted"}', '${RECRUITER}')`);
const twice = await db.query(`insert into company_approval_requests (company_id, kind, subject_id, requested_by) values ('${COMPANY}', 'decline', '${application}', '${RECRUITER}')`).then(() => true, () => false);
report.check('once per applicant while it waits', twice === false);
const selfApprove = await as(RECRUITER, `update company_approval_requests set status = 'approved', decided_by = '${RECRUITER}' returning id`);
report.check('the asker cannot decide it', selfApprove.rows.length === 0);
const decided = await as(OWNER, `update company_approval_requests set status = 'approved', decided_by = '${OWNER}', decided_at = now() returning id`);
report.check('an admin decides it', decided.rows.length === 1, decided.error);

report.section('CVs, admins only');
report.check('the admin may open the CV', (await as(OWNER, `select public.may_read_application_cv('${application}') as ok`)).rows[0]?.ok === true);
report.check('the recruiter may not', (await as(RECRUITER, `select public.may_read_application_cv('${application}') as ok`)).rows[0]?.ok === false);
report.check('the candidate always may', (await as(CANDIDATE, `select public.may_read_application_cv('${application}') as ok`)).rows[0]?.ok === true);

report.section('a second factor, required');
const turnedOn = await as(OWNER, `update company_policies set require_mfa = true where company_id = '${COMPANY}' returning company_id`, 'aal2');
report.check('an admin who used a second factor requires it', turnedOn.ok && turnedOn.rows.length === 1, turnedOn.error);
await db.exec(`update company_policies set require_mfa = true where company_id = '${COMPANY}'`);
const noFactor = await as(RECRUITER, `select id from applications where id = '${application}'`);
report.check('a member without one reads none of the applicants', noFactor.ok && noFactor.rows.length === 0, noFactor.error);
const why = await as(RECRUITER, `select * from public.company_rules()`);
report.check('and is told why', why.rows[0]?.require_mfa === true && why.rows[0]?.mfa_satisfied === false);
const withFactor = await as(RECRUITER, `select id from applications where id = '${application}'`, 'aal2');
report.check('with one, everything is as it was', withFactor.rows.length === 1, withFactor.error);
report.check('the candidate is not touched', (await as(CANDIDATE, `select id from applications where id = '${application}'`)).rows.length === 1);

process.exit(report.finish() ? 0 : 1);
