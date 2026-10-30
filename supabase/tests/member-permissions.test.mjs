/**
 * What each member may do (migration 376): the owner always; a member as
 * their switches say; and a member kept from revealing is refused by the
 * database itself.
 *
 * Run with: node supabase/tests/member-permissions.test.mjs
 */
import { createTestDb, reporter, runner } from './setup.mjs';

const db = await createTestDb();
const report = reporter();
const as = runner(db);

const OWNER = 'cdcdcdcd-1111-0000-0000-000000000001';
const RECRUITER = 'cdcdcdcd-1111-0000-0000-000000000002';
const CONSULTANT = 'cdcdcdcd-2222-0000-0000-000000000001';
const COMPANY = 'cdcdcdcd-3333-0000-0000-000000000001';

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
    ('${OWNER}', 'owner-p@demo.test', now(), now(), now()),
    ('${RECRUITER}', 'rec-p@demo.test', now(), now(), now()),
    ('${CONSULTANT}', 'cons-p@demo.test', now(), now(), now());
  insert into profiles (id, role, full_name, whatsapp_phone, approval_status) values
    ('${OWNER}', 'employer', 'المالك', '+201044400001', 'approved'),
    ('${RECRUITER}', 'employer', 'المجنّد', '+201044400002', 'approved'),
    ('${CONSULTANT}', 'candidate', 'استشاري', '+201044400003', 'approved');
  insert into companies (id, owner_id, name_ar, slug, verification_status) values
    ('${COMPANY}', '${OWNER}', 'شركة الصلاحيات', 'perm-co', 'verified');
  insert into company_members (company_id, user_id, role) values ('${COMPANY}', '${RECRUITER}', 'recruiter');
  insert into agent_profiles (user_id, slug, visibility, visibility_chosen_at) values ('${CONSULTANT}', 'perm-consultant', 'public', now());
  -- Sign-up holds an employer for review; these two have been approved.
  update profiles set approval_status = 'approved' where id in ('${OWNER}', '${RECRUITER}', '${CONSULTANT}');
`);

const can = async (userId, permission) => (await as(userId, `select public.member_can('${COMPANY}', '${permission}') as ok`)).rows[0]?.ok;

report.section('the defaults keep what members could do');
report.check('a recruiter may post', (await can(RECRUITER, 'post')) === true);
report.check('and reveal', (await can(RECRUITER, 'reveal')) === true);
report.check('but not spend', (await can(RECRUITER, 'spend')) === false);
report.check('the owner may do all three', (await can(OWNER, 'post')) && (await can(OWNER, 'reveal')) && (await can(OWNER, 'spend')));

report.section('a member kept from revealing is refused by the database');
const before = await as(RECRUITER, `select status from public.reveal_agent_contact('perm-consultant')`);
report.check('allowed, the reveal answers', before.rows[0]?.status === 'ok', before.error ?? before.rows[0]?.status);
await db.exec(`update company_members set can_reveal = false where user_id = '${RECRUITER}'`);
const after = await as(RECRUITER, `select status from public.reveal_agent_contact('perm-consultant')`);
report.check('switched off, it is not permitted', after.rows[0]?.status === 'not_permitted', after.rows[0]?.status);
await db.exec(`update company_members set can_reveal = false where user_id = '${OWNER}'`);
const owner = await as(OWNER, `select status from public.reveal_agent_contact('perm-consultant')`);
report.check('the owner reveals whatever is stored', owner.rows[0]?.status === 'ok', owner.rows[0]?.status);

process.exit(report.finish() ? 0 : 1);
