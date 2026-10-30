/**
 * Replies a team keeps (migration 374): members read the team's and their
 * own; anyone writes their own; only an admin writes the team's; another
 * company reads nothing.
 *
 * Run with: node supabase/tests/saved-replies.test.mjs
 */
import { createTestDb, reporter, runner } from './setup.mjs';

const db = await createTestDb();
const report = reporter();
const as = runner(db);

const OWNER = 'ffffffff-1111-0000-0000-000000000001';
const RECRUITER = 'ffffffff-1111-0000-0000-000000000002';
const STRANGER = 'ffffffff-1111-0000-0000-000000000003';
const COMPANY = 'ffffffff-3333-0000-0000-000000000001';
const OTHER_CO = 'ffffffff-3333-0000-0000-000000000002';

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
    ('${OWNER}', 'owner-r@demo.test', now(), now(), now()),
    ('${RECRUITER}', 'rec-r@demo.test', now(), now(), now()),
    ('${STRANGER}', 'stranger-r@demo.test', now(), now(), now());
  insert into profiles (id, role, full_name, whatsapp_phone, approval_status) values
    ('${OWNER}', 'employer', 'المالك', '+201066600001', 'approved'),
    ('${RECRUITER}', 'employer', 'المجنّد', '+201066600002', 'approved'),
    ('${STRANGER}', 'employer', 'غريب', '+201066600003', 'approved');
  insert into companies (id, owner_id, name_ar, slug, verification_status) values
    ('${COMPANY}', '${OWNER}', 'شركة الردود المحفوظة', 'replies-co', 'verified'),
    ('${OTHER_CO}', '${STRANGER}', 'شركة أخرى', 'replies-other-co', 'verified');
  insert into company_members (company_id, user_id, role) values ('${COMPANY}', '${RECRUITER}', 'recruiter');
  insert into saved_replies (company_id, person_id, body) values
    ('${COMPANY}', null, 'رد الفريق'),
    ('${COMPANY}', '${OWNER}', 'رد المالك'),
    ('${COMPANY}', '${RECRUITER}', 'رد المجنّد');
`);

const bodies = async (userId) => (await as(userId, `select body from saved_replies order by body`)).rows.map((row) => row.body);

report.section('who reads what');
const recruiterSees = await bodies(RECRUITER);
report.check("a recruiter reads the team's and their own", recruiterSees.length === 2 && recruiterSees.includes('رد الفريق') && recruiterSees.includes('رد المجنّد'));
report.check("not a colleague's own", !recruiterSees.includes('رد المالك'));
report.check('another company reads nothing', (await bodies(STRANGER)).length === 0);

report.section('who writes what');
const ownWrite = await as(RECRUITER, `insert into saved_replies (company_id, person_id, body) values ('${COMPANY}', '${RECRUITER}', 'جديد') returning id`);
report.check('a recruiter keeps their own', ownWrite.ok, ownWrite.error);
const teamWriteRecruiter = await as(RECRUITER, `insert into saved_replies (company_id, person_id, body) values ('${COMPANY}', null, 'للفريق') returning id`);
report.check("a recruiter cannot write the team's", !teamWriteRecruiter.ok);
const teamWriteOwner = await as(OWNER, `insert into saved_replies (company_id, person_id, body) values ('${COMPANY}', null, 'للفريق') returning id`);
report.check("an admin writes the team's", teamWriteOwner.ok, teamWriteOwner.error);
const elsewhere = await as(STRANGER, `insert into saved_replies (company_id, person_id, body) values ('${COMPANY}', '${STRANGER}', 'دخيل') returning id`);
report.check("nobody writes into another company's", !elsewhere.ok);
const forOther = await as(RECRUITER, `insert into saved_replies (company_id, person_id, body) values ('${COMPANY}', '${OWNER}', 'باسم غيري') returning id`);
report.check("nobody writes one as a colleague's own", !forOther.ok);
const removeOthers = await as(RECRUITER, `delete from saved_replies where body = 'رد المالك' returning id`);
report.check("nobody removes a colleague's own", removeOthers.ok && removeOthers.rows.length === 0);

process.exit(report.finish() ? 0 : 1);
