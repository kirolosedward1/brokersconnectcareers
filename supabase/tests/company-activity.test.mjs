/**
 * What the team did (migration 377): every move a member makes is written by
 * the tables' own triggers, read back by the company's admins in full and by
 * anybody else on the team as their own only, for six months.
 *
 * Run with: node supabase/tests/company-activity.test.mjs
 */
import { createTestDb, reporter, runner } from './setup.mjs';

const db = await createTestDb();
const report = reporter();
const as = runner(db);
const one = async (sql) => (await db.query(sql)).rows[0];

// Written and kept, as the website's own session would: the triggers read auth.uid().
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
    return { ok: false, error: error.message };
  }
}

const OWNER = 'acacacac-1111-0000-0000-000000000001';
const RECRUITER = 'acacacac-1111-0000-0000-000000000002';
const STRANGER = 'acacacac-1111-0000-0000-000000000003';
const NEWCOMER = 'acacacac-1111-0000-0000-000000000004';
const CANDIDATE = 'acacacac-2222-0000-0000-000000000001';
const COMPANY = 'acacacac-3333-0000-0000-000000000001';
const OTHER_CO = 'acacacac-3333-0000-0000-000000000002';

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
    ('${OWNER}', 'owner-a@demo.test', now(), now(), now()),
    ('${RECRUITER}', 'rec-a@demo.test', now(), now(), now()),
    ('${STRANGER}', 'stranger-a@demo.test', now(), now(), now()),
    ('${NEWCOMER}', 'new-a@demo.test', now(), now(), now()),
    ('${CANDIDATE}', 'cand-a@demo.test', now(), now(), now());
  insert into profiles (id, role, full_name, whatsapp_phone, approval_status) values
    ('${OWNER}', 'employer', 'المالك', '+201055510001', 'approved'),
    ('${RECRUITER}', 'employer', 'منى المجنّدة', '+201055510002', 'approved'),
    ('${STRANGER}', 'employer', 'غريب', '+201055510003', 'approved'),
    ('${NEWCOMER}', 'employer', 'زميل جديد', '+201055510004', 'approved'),
    ('${CANDIDATE}', 'candidate', 'سارة عادل', '+201055510005', 'approved')
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
  -- Becoming an employer resets the approval; these accounts are past it.
  update profiles set approval_status = 'approved' where id in ('${OWNER}', '${RECRUITER}', '${STRANGER}', '${NEWCOMER}', '${CANDIDATE}');
  insert into companies (id, owner_id, name_ar, slug, verification_status) values
    ('${COMPANY}', '${OWNER}', 'شركة السجل', 'activity-co', 'verified'),
    ('${OTHER_CO}', '${STRANGER}', 'شركة أخرى', 'activity-other-co', 'verified');
  insert into company_members (company_id, user_id, role) values ('${COMPANY}', '${RECRUITER}', 'recruiter');
`);
const job = (await one(`
  insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band,
                    district_id, commission_type, leads_source, description_ar, status, published_at, expires_at)
  values ('${COMPANY}', 'مستشار مبيعات', 'activity-job', 'primary', 'full_time', 'junior_1_3',
          (select id from districts limit 1), 'none', 'company_provided', 'وصف', 'active', now(), now() + interval '30 days')
  returning id`)).id;
const application = (await one(
  `insert into applications (job_id, candidate_id, experience_band) values ('${job}', '${CANDIDATE}', 'junior_1_3') returning id`,
)).id;
// What setting up wrote (by nobody signed in) is not what is being tested.
await db.exec('delete from company_activity');

report.section('a member’s moves are written by the tables themselves');
const moved = await commitAs(RECRUITER, `update applications set status = 'shortlisted' where id = '${application}' returning id`);
report.check('the recruiter shortlists', moved.ok && moved.rows.length === 1, moved.error);
const noted = await commitAs(RECRUITER, `insert into application_notes (application_id, author_id, body) values ('${application}', '${RECRUITER}', 'كلمتها') returning id`);
report.check('and writes a note', noted.ok, noted.error);
const closed = await commitAs(OWNER, `update jobs set status = 'closed' where id = '${job}' returning id`);
report.check('the owner closes the listing', closed.ok && closed.rows.length === 1, closed.error);
const added = await commitAs(OWNER, `insert into company_members (company_id, user_id, role) values ('${COMPANY}', '${NEWCOMER}', 'recruiter') returning user_id`);
report.check('and adds a colleague', added.ok, added.error);

const rows = (await db.query(`select kind, actor_id, detail from company_activity where company_id = '${COMPANY}' order by id`)).rows;
const kinds = rows.map((row) => row.kind);
report.check('four rows, one for each', JSON.stringify(kinds) === JSON.stringify(['application_moved', 'note_added', 'job_status', 'member_added']), kinds.join(', '));
report.check('each by who did it', rows[0]?.actor_id === RECRUITER && rows[2]?.actor_id === OWNER);
report.check('a move says from and to', rows[0]?.detail?.from === 'new' && rows[0]?.detail?.to === 'shortlisted');
const words = await one(`select count(*)::int as n from company_activity where detail::text like '%كلمتها%'`);
report.check("a note's words are not copied into the log", words.n === 0);

report.section('what is not the team’s is not in its log');
const withdrawn = await commitAs(CANDIDATE, `update applications set status = 'withdrawn' where id = '${application}' returning id`);
report.check('the candidate withdraws', withdrawn.ok, withdrawn.error);
const afterWithdraw = await one(`select count(*)::int as n from company_activity where company_id = '${COMPANY}' and kind = 'application_moved'`);
report.check("and their own move is not recorded as the team's", afterWithdraw.n === 1);

report.section('who reads what');
const ownerReads = await as(OWNER, `select * from public.company_activity_page()`);
report.check('the owner (an admin) reads everyone’s', ownerReads.ok && ownerReads.rows.length === 4, ownerReads.error);
report.check('newest first', ownerReads.rows[0]?.kind === 'member_added');
report.check('with names read now, not stored', ownerReads.rows.find((r) => r.kind === 'application_moved')?.actor_name === 'منى المجنّدة');
report.check('and the listing and the candidate', ownerReads.rows.find((r) => r.kind === 'application_moved')?.candidate_name === 'سارة عادل'
  && ownerReads.rows.find((r) => r.kind === 'job_status')?.job_title_ar === 'مستشار مبيعات');
const narrowed = await as(OWNER, `select * from public.company_activity_page(null, null, '${RECRUITER}')`);
report.check('and may narrow it to one member', narrowed.rows.length === 2 && narrowed.rows.every((r) => r.actor_id === RECRUITER));
const recruiterReads = await as(RECRUITER, `select * from public.company_activity_page(null, null, '${OWNER}')`);
report.check('a recruiter reads only their own, whatever they ask for', recruiterReads.rows.length === 2 && recruiterReads.rows.every((r) => r.actor_id === RECRUITER));
const strangerReads = await as(STRANGER, `select * from public.company_activity_page()`);
report.check('another company reads none of it', strangerReads.ok && strangerReads.rows.length === 0);
const direct = await as(OWNER, `select id from company_activity`);
report.check('nobody reads the table itself', !direct.ok || direct.rows.length === 0);
const forged = await as(OWNER, `insert into company_activity (company_id, kind) values ('${COMPANY}', 'order_paid')`);
report.check('nor writes it', !forged.ok);

report.section('a page at a time');
const firstPage = await as(OWNER, `select * from public.company_activity_page(null, null, null, 2)`);
const last = firstPage.rows.at(-1);
const nextPage = await as(OWNER, `select * from public.company_activity_page('${last?.at?.toISOString?.() ?? last?.at}', ${last?.id}, null, 2)`);
report.check('two, then the next two', firstPage.rows.length === 2 && nextPage.rows.length === 2, nextPage.error);
report.check('without repeating one', !nextPage.rows.some((r) => firstPage.rows.some((f) => f.id === r.id)));

report.section('six months');
await db.exec(`insert into company_activity (company_id, actor_id, kind, created_at) values ('${COMPANY}', '${OWNER}', 'job_created', now() - interval '7 months')`);
const kept = await as(OWNER, `select * from public.company_activity_page()`);
report.check('a row older than six months is not read', kept.rows.length === 4);
const purged = await one(`select public.purge_company_activity() as n`);
report.check('and the nightly purge removes it', purged.n === 1);

report.section('a payment the provider confirms');
await db.exec(`insert into orders (company_id, pack_key, credits, amount_egp) values ('${COMPANY}', 'bulk', 5, 1000)`);
await db.exec(`update orders set status = 'paid' where company_id = '${COMPANY}'`);
const paid = await one(`select actor_id, detail from company_activity where company_id = '${COMPANY}' and kind = 'order_paid'`);
report.check('is recorded with the pack, and nobody as its actor', paid?.actor_id === null && paid?.detail?.pack === 'bulk' && paid?.detail?.credits === 5);

report.section('a company that goes takes its log with it');
// The other company: one with applications is kept for them (applications_job_id_fkey).
await db.exec(`insert into company_activity (company_id, kind) values ('${OTHER_CO}', 'order_paid')`);
const gone = await db.query(`delete from companies where id = '${OTHER_CO}'`).then(() => true, (error) => error.message);
report.check('deleting a company is not stopped by its members leaving', gone === true, gone);
const left = await one(`select count(*)::int as n from company_activity where company_id = '${OTHER_CO}'`);
report.check('and nothing of it is left', left.n === 0);

process.exit(report.finish() ? 0 : 1);
