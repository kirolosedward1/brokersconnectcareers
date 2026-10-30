/**
 * What a company knows of a candidate (migration 375): notes about the
 * person, read on every application they send the company and by nobody
 * else; and the company's own earlier applications from them.
 *
 * Run with: node supabase/tests/candidate-notes.test.mjs
 */
import { createTestDb, reporter, runner } from './setup.mjs';

const db = await createTestDb();
const report = reporter();
const as = runner(db);
const one = async (sql) => (await db.query(sql)).rows[0];

const OWNER = 'abababab-1111-0000-0000-000000000001';
const RECRUITER = 'abababab-1111-0000-0000-000000000002';
const STRANGER = 'abababab-1111-0000-0000-000000000003';
const CANDIDATE = 'abababab-2222-0000-0000-000000000001';
const COMPANY = 'abababab-3333-0000-0000-000000000001';
const OTHER_CO = 'abababab-3333-0000-0000-000000000002';

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
    ('${OWNER}', 'owner-n@demo.test', now(), now(), now()),
    ('${RECRUITER}', 'rec-n@demo.test', now(), now(), now()),
    ('${STRANGER}', 'stranger-n@demo.test', now(), now(), now()),
    ('${CANDIDATE}', 'cand-n@demo.test', now(), now(), now());
  insert into profiles (id, role, full_name, whatsapp_phone, approval_status) values
    ('${OWNER}', 'employer', 'المالك', '+201055500001', 'approved'),
    ('${RECRUITER}', 'employer', 'المجنّد', '+201055500002', 'approved'),
    ('${STRANGER}', 'employer', 'غريب', '+201055500003', 'approved'),
    ('${CANDIDATE}', 'candidate', 'سارة عادل', '+201055500004', 'approved');
  insert into companies (id, owner_id, name_ar, slug, verification_status) values
    ('${COMPANY}', '${OWNER}', 'شركة الملاحظات', 'notes-co', 'verified'),
    ('${OTHER_CO}', '${STRANGER}', 'شركة أخرى', 'notes-other-co', 'verified');
  insert into company_members (company_id, user_id, role) values ('${COMPANY}', '${RECRUITER}', 'recruiter');
`);
const job = async (company, slug) =>
  (await one(`
    insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band,
                      district_id, commission_type, leads_source, description_ar, status, published_at, expires_at)
    values ('${company}', 'وظيفة ${slug}', '${slug}', 'primary', 'full_time', 'junior_1_3',
            (select id from districts limit 1), 'none', 'company_provided', 'وصف', 'active', now(), now() + interval '30 days')
    returning id`)).id;
const march = await job(COMPANY, 'notes-march');
const june = await job(COMPANY, 'notes-june');
const elsewhere = await job(OTHER_CO, 'notes-elsewhere');
const apply = async (jobId, status = 'new') =>
  (await one(`insert into applications (job_id, candidate_id, experience_band, status) values ('${jobId}', '${CANDIDATE}', 'junior_1_3', '${status}') returning id`)).id;
const first = await apply(march, 'rejected');
const second = await apply(june);
const theirs = await apply(elsewhere);

report.section('a note about the person, written once, read on every application');
await db.exec('begin');
await db.exec('set local role authenticated;');
await db.exec(`set local request.jwt.claim.sub = '${RECRUITER}';`);
await db.exec(`set local request.jwt.claims = '{"role":"authenticated","sub":"${RECRUITER}"}';`);
await db.query(`insert into company_candidate_notes (company_id, candidate_id, author_id, body) values ('${COMPANY}', '${CANDIDATE}', '${RECRUITER}', 'تحدثنا معها في مارس، متاحة من أول الشهر')`);
await db.exec('commit');
const onJune = await as(OWNER, `select * from public.candidate_notes_for(array['${second}']::uuid[])`);
report.check("the June application's card reads the note written on the person", onJune.rows.length === 1, onJune.error);
const onMarch = await as(OWNER, `select * from public.candidate_notes_for(array['${first}']::uuid[])`);
report.check('so does the March one', onMarch.rows.length === 1);

report.section('nobody else reads or writes them');
const strangerReads = await as(STRANGER, `select * from public.candidate_notes_for(array['${theirs}']::uuid[])`);
report.check("another company the person applied to reads nothing of this one's notes", strangerReads.rows.length === 0);
const strangerTable = await as(STRANGER, `select id from company_candidate_notes`);
report.check('nor the table', strangerTable.ok && strangerTable.rows.length === 0);
const candidateReads = await as(CANDIDATE, `select id from company_candidate_notes`);
report.check('the candidate reads none', candidateReads.ok && candidateReads.rows.length === 0);
const strangerWrite = await as(STRANGER, `insert into company_candidate_notes (company_id, candidate_id, author_id, body) values ('${COMPANY}', '${CANDIDATE}', '${STRANGER}', 'دخيل')`);
report.check("nobody writes into another company's", !strangerWrite.ok);
const asSomeoneElse = await as(RECRUITER, `insert into company_candidate_notes (company_id, candidate_id, author_id, body) values ('${COMPANY}', '${CANDIDATE}', '${OWNER}', 'باسم غيري')`);
report.check('nobody writes one as a colleague', !asSomeoneElse.ok);

report.section("removing: the author, or the company's admin");
const ownerRemoves = await as(OWNER, `delete from company_candidate_notes returning id`);
report.check("the owner (an admin) removes a colleague's note", ownerRemoves.rows.length === 1);

report.section('«تقدّم من قبل»: the other applications to this company only');
const history = await as(OWNER, `select * from public.candidate_history_for(array['${second}']::uuid[])`);
report.check('the June card shows the March application', history.rows.length === 1 && history.rows[0].application_id === first, history.error);
report.check('and how it ended', history.rows[0]?.status === 'rejected');
const historyElsewhere = await as(STRANGER, `select * from public.candidate_history_for(array['${theirs}']::uuid[])`);
report.check("another company does not see this company's applications", historyElsewhere.rows.length === 0);

process.exit(report.finish() ? 0 : 1);
