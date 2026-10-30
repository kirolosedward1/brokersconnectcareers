/**
 * Interview invites (migration 372): the company invites, the candidate
 * answers only through answer_interview(), each side hears it in the bell,
 * and nobody else reads or writes them.
 *
 * Run with: node supabase/tests/interviews.test.mjs
 */
import { createTestDb, reporter, runner } from './setup.mjs';

const db = await createTestDb();
const report = reporter();
const as = runner(db);
const one = async (sql) => (await db.query(sql)).rows[0];

const OWNER = 'eeeeeeee-1111-0000-0000-000000000001';
const STRANGER = 'eeeeeeee-1111-0000-0000-000000000002';
const CANDIDATE = 'eeeeeeee-2222-0000-0000-000000000001';
const COMPANY = 'eeeeeeee-3333-0000-0000-000000000001';
const OTHER_CO = 'eeeeeeee-3333-0000-0000-000000000002';

/** As this person, kept: the transaction commits. */
async function commitAs(userId, sql) {
  await db.exec('begin');
  try {
    await db.exec('set local role authenticated;');
    await db.exec(`set local request.jwt.claim.sub = '${userId}';`);
    await db.exec(`set local request.jwt.claims = '{"role":"authenticated","sub":"${userId}"}';`);
    const result = await db.query(sql);
    await db.exec('commit');
    return { ok: true, rows: result.rows };
  } catch (error) {
    await db.exec('rollback');
    return { ok: false, error: error.message, rows: [] };
  }
}

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
    ('${OWNER}', 'owner-iv@demo.test', now(), now(), now()),
    ('${STRANGER}', 'stranger-iv@demo.test', now(), now(), now()),
    ('${CANDIDATE}', 'cand-iv@demo.test', now(), now(), now());
  insert into profiles (id, role, full_name, whatsapp_phone, approval_status) values
    ('${OWNER}', 'employer', 'صاحب الشركة', '+201077700001', 'approved'),
    ('${STRANGER}', 'employer', 'شركة أخرى', '+201077700002', 'approved'),
    ('${CANDIDATE}', 'candidate', 'سارة عادل', '+201077700003', 'approved');
  insert into companies (id, owner_id, name_ar, slug, verification_status) values
    ('${COMPANY}', '${OWNER}', 'شركة المقابلات', 'interview-co', 'verified'),
    ('${OTHER_CO}', '${STRANGER}', 'شركة أخرى', 'interview-other-co', 'verified');
`);
const job = await one(`
  insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band,
                    district_id, commission_type, leads_source, description_ar, status, published_at, expires_at)
  values ('${COMPANY}', 'استشاري مبيعات', 'interview-job', 'primary', 'full_time', 'junior_1_3',
          (select id from districts limit 1), 'none', 'company_provided', 'وصف', 'active', now(), now() + interval '30 days')
  returning id`);
const application = await one(`
  insert into applications (job_id, candidate_id, experience_band)
  values ('${job.id}', '${CANDIDATE}', 'junior_1_3') returning id`);

const bell = async (userId, kind) =>
  Number((await one(`select count(*) as n from notifications where user_id = '${userId}' and kind = '${kind}'`)).n);

report.section('the company invites, and the candidate hears it');
const invited = await commitAs(OWNER, `
  insert into interview_invites (application_id, starts_at, minutes, mode, place, created_by)
  values ('${application.id}', now() + interval '2 days', 45, 'office', 'التجمع الخامس', '${OWNER}')
  returning id`);
report.check('the owner invites', invited.ok, invited.error);
const inviteId = invited.rows[0]?.id;
report.check('the candidate has an interview_invited notice', (await bell(CANDIDATE, 'interview_invited')) === 1);

report.section('nobody else reads or writes it');
const strangerRead = await as(STRANGER, `select id from interview_invites`);
report.check('another company reads nothing', strangerRead.ok && strangerRead.rows.length === 0);
const strangerWrite = await as(STRANGER, `
  insert into interview_invites (application_id, starts_at, mode) values ('${application.id}', now() + interval '1 day', 'phone')`);
report.check('another company cannot invite', !strangerWrite.ok);
const candidateRead = await as(CANDIDATE, `select id from interview_invites`);
report.check('the candidate reads their own', candidateRead.rows.length === 1);
const candidateWrite = await as(CANDIDATE, `update interview_invites set status = 'accepted' returning id`);
report.check('the candidate cannot change it directly', candidateWrite.ok && candidateWrite.rows.length === 0);

report.section('the candidate answers through answer_interview()');
const past = await as(CANDIDATE, `select public.answer_interview('${inviteId}', 'counter', now() - interval '1 day') as r`);
report.check('a proposed time in the past is refused', past.rows[0]?.r === 'invalid');
const strangerAnswer = await as(STRANGER, `select public.answer_interview('${inviteId}', 'accepted') as r`);
report.check('somebody else cannot answer it', strangerAnswer.rows[0]?.r === 'not_found');
const counter = await commitAs(CANDIDATE, `select public.answer_interview('${inviteId}', 'counter', now() + interval '3 days') as r`);
report.check('the candidate proposes another time', counter.rows[0]?.r === 'ok', counter.error);
report.check('the company hears the answer', (await bell(OWNER, 'interview_answered')) === 1);
const again = await as(CANDIDATE, `select public.answer_interview('${inviteId}', 'accepted') as r`);
report.check('an answered invitation cannot be answered again', again.rows[0]?.r === 'closed');

report.section('the company accepts the proposed time');
const accept = await commitAs(OWNER, `
  update interview_invites set starts_at = counter_starts_at, status = 'accepted', updated_at = now()
   where id = '${inviteId}' returning status`);
report.check('the owner accepts it', accept.rows[0]?.status === 'accepted', accept.error);
report.check('no second invitation notice for an accepted time', (await bell(CANDIDATE, 'interview_invited')) === 1);

report.section('both kinds are pushed under the applications switch');
report.check('interview_invited', (await one(`select public.push_category('interview_invited') as c`)).c === 'applications');
report.check('interview_answered', (await one(`select public.push_category('interview_answered') as c`)).c === 'applications');

process.exit(report.finish() ? 0 : 1);
