/**
 * Who revealed a number (migration 381): a company reads when it last
 * revealed a consultant, and only its own reveals; a consultant reads which
 * companies revealed theirs, and nobody else's log.
 *
 * Run with: node supabase/tests/reveal-reads.test.mjs
 */
import { createTestDb, reporter, runner } from './setup.mjs';

const db = await createTestDb();
const report = reporter();
const as = runner(db);

const OWNER = 'babababa-1111-0000-0000-000000000001';
const OTHER = 'babababa-1111-0000-0000-000000000002';
const CONSULTANT = 'babababa-2222-0000-0000-000000000001';
const SOMEONE = 'babababa-2222-0000-0000-000000000002';
const COMPANY = 'babababa-3333-0000-0000-000000000001';
const OTHER_CO = 'babababa-3333-0000-0000-000000000002';

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
    ('${OWNER}', 'owner-v@demo.test', now(), now(), now()),
    ('${OTHER}', 'other-v@demo.test', now(), now(), now()),
    ('${CONSULTANT}', 'cons-v@demo.test', now(), now(), now()),
    ('${SOMEONE}', 'some-v@demo.test', now(), now(), now());
  insert into profiles (id, role, full_name, whatsapp_phone, approval_status) values
    ('${OWNER}', 'employer', 'المالك', '+201044410001', 'approved'),
    ('${OTHER}', 'employer', 'آخر', '+201044410002', 'approved'),
    ('${CONSULTANT}', 'candidate', 'استشاري', '+201044410003', 'approved'),
    ('${SOMEONE}', 'candidate', 'غيره', '+201044410004', 'approved')
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
  update profiles set approval_status = 'approved' where id in ('${OWNER}', '${OTHER}', '${CONSULTANT}', '${SOMEONE}');
  insert into companies (id, owner_id, name_ar, slug, verification_status) values
    ('${COMPANY}', '${OWNER}', 'شركة كشفت', 'revealed-co', 'verified'),
    ('${OTHER_CO}', '${OTHER}', 'شركة أخرى', 'other-revealed-co', 'verified');
  insert into agent_profiles (user_id, slug, visibility, visibility_chosen_at) values
    ('${CONSULTANT}', 'reveal-consultant', 'public', now()),
    ('${SOMEONE}', 'reveal-someone', 'public', now());
  insert into agent_contact_reveals (agent_id, viewer_id, company_id, created_at) values
    ((select id from agent_profiles where slug = 'reveal-consultant'), '${OWNER}', '${COMPANY}', now() - interval '3 days'),
    ((select id from agent_profiles where slug = 'reveal-consultant'), '${OTHER}', '${OTHER_CO}', now() - interval '1 day');
`);

report.section('«كشف سابق»');
const mine = await as(OWNER, `select public.my_company_revealed('reveal-consultant') as at`);
report.check('a company reads when it last revealed a consultant', Boolean(mine.rows[0]?.at), mine.error);
const never = await as(OWNER, `select public.my_company_revealed('reveal-someone') as at`);
report.check('and nothing for one it never did', never.rows[0]?.at === null);
const another = await as(OTHER, `select public.my_company_revealed('reveal-consultant') as at`);
report.check("another company reads its own reveal, not this one's", Boolean(another.rows[0]?.at) && new Date(another.rows[0].at) > new Date(mine.rows[0].at));
const candidate = await as(SOMEONE, `select public.my_company_revealed('reveal-consultant') as at`);
report.check('somebody with no company reads nothing', candidate.rows[0]?.at === null);

report.section("the consultant's log");
const log = await as(CONSULTANT, `select * from public.my_contact_reveals()`);
report.check('the consultant reads both companies, newest first', log.rows.length === 2 && log.rows[0].company_name_ar === 'شركة أخرى', log.error);
report.check('by company, never by the person who pressed', !('viewer_id' in (log.rows[0] ?? {})));
const notTheirs = await as(SOMEONE, `select * from public.my_contact_reveals()`);
report.check("nobody reads another consultant's log", notTheirs.ok && notTheirs.rows.length === 0);
const signedOut = await db.query(`begin; set local role anon; select public.my_contact_reveals();`).then(() => true, () => false);
await db.exec('rollback').catch(() => {});
report.check('the signed-out side cannot ask', signedOut === false);

process.exit(report.finish() ? 0 : 1);
