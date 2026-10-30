/**
 * A team of five (migration 371): the owner and four more, and a sixth is
 * refused with `team_full`; a place freed is a place again.
 *
 * Run with: node supabase/tests/team-cap.test.mjs
 */
import { createTestDb, reporter } from './setup.mjs';

const db = await createTestDb();
const report = reporter();
const one = async (sql) => (await db.query(sql)).rows[0];

const OWNER = 'dddddddd-1111-0000-0000-000000000001';
const COMPANY = 'dddddddd-3333-0000-0000-000000000001';

async function employer(index) {
  const id = `dddddddd-2222-0000-0000-${String(index).padStart(12, '0')}`;
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
      values ('${id}', 'member${index}@demo.test', now(), now(), now());
    insert into profiles (id, role, full_name, whatsapp_phone, approval_status)
      values ('${id}', 'employer', 'عضو ${index}', '+2010888${String(index).padStart(5, '0')}', 'approved');
  `);
  return id;
}

async function add(userId) {
  try {
    await db.exec(`insert into company_members (company_id, user_id, role) values ('${COMPANY}', '${userId}', 'recruiter')`);
    return 'added';
  } catch (error) {
    return String(error.message);
  }
}

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
    values ('${OWNER}', 'owner@demo.test', now(), now(), now());
  insert into profiles (id, role, full_name, whatsapp_phone, approval_status)
    values ('${OWNER}', 'employer', 'المالك', '+201088800001', 'approved');
  insert into companies (id, owner_id, name_ar, slug, verification_status)
    values ('${COMPANY}', '${OWNER}', 'شركة الفريق', 'team-cap-co', 'verified');
`);

const count = async () => Number((await one(`select count(*) as n from company_members where company_id = '${COMPANY}'`)).n);

report.section('the owner counts as one of the five');
report.check('the owner is a member when the company is made', (await count()) === 1);

report.section('four more fit, a sixth does not');
const members = [];
for (let index = 1; index <= 5; index += 1) members.push(await employer(index));
const outcomes = [];
for (const member of members) outcomes.push(await add(member));
report.check('the second to fifth are added', outcomes.slice(0, 4).every((outcome) => outcome === 'added'));
report.check('the sixth is refused with team_full', outcomes[4].includes('team_full'));
report.check('the team stays at five', (await count()) === 5);

report.section('a place freed is a place again');
await db.exec(`delete from company_members where company_id = '${COMPANY}' and user_id = '${members[0]}'`);
report.check('the sixth fits once one has left', (await add(members[4])) === 'added');
report.check('five again', (await count()) === 5);

process.exit(report.finish() ? 0 : 1);
