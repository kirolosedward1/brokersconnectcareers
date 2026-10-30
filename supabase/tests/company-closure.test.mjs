/**
 * Who owns the company, and when it goes (migration 379): ownership moves
 * only to a member; a closing company is hidden at once and goes on its 14th
 * day — deleted, or closed and emptied when it has been paid for; a company
 * may purge its closed listings' applications; and the candidate keeps a
 * record of each application that went.
 *
 * Run with: node supabase/tests/company-closure.test.mjs
 */
import { createTestDb, reporter, runner } from './setup.mjs';

const db = await createTestDb();
const report = reporter();
const as = runner(db);
const one = async (sql) => (await db.query(sql)).rows[0];

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

const OWNER = 'aeaeaeae-1111-0000-0000-000000000001';
const RECRUITER = 'aeaeaeae-1111-0000-0000-000000000002';
const OUTSIDER = 'aeaeaeae-1111-0000-0000-000000000003';
const OWNER2 = 'aeaeaeae-1111-0000-0000-000000000004';
const CANDIDATE = 'aeaeaeae-2222-0000-0000-000000000001';
const COMPANY = 'aeaeaeae-3333-0000-0000-000000000001';
const PAID = 'aeaeaeae-3333-0000-0000-000000000002';

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
    ('${OWNER}', 'owner-c@demo.test', now(), now(), now()),
    ('${RECRUITER}', 'rec-c@demo.test', now(), now(), now()),
    ('${OUTSIDER}', 'out-c@demo.test', now(), now(), now()),
    ('${OWNER2}', 'owner2-c@demo.test', now(), now(), now()),
    ('${CANDIDATE}', 'cand-c@demo.test', now(), now(), now());
  insert into profiles (id, role, full_name, whatsapp_phone, approval_status) values
    ('${OWNER}', 'employer', 'المالك', '+201055530001', 'approved'),
    ('${RECRUITER}', 'employer', 'المجنّد', '+201055530002', 'approved'),
    ('${OUTSIDER}', 'employer', 'غريب', '+201055530003', 'approved'),
    ('${OWNER2}', 'employer', 'مالك آخر', '+201055530004', 'approved'),
    ('${CANDIDATE}', 'candidate', 'سارة', '+201055530005', 'approved')
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
  update profiles set approval_status = 'approved' where id in ('${OWNER}', '${RECRUITER}', '${OUTSIDER}', '${OWNER2}', '${CANDIDATE}');
  insert into companies (id, owner_id, name_ar, slug, verification_status) values
    ('${COMPANY}', '${OWNER}', 'شركة تغلق', 'closing-co', 'verified'),
    ('${PAID}', '${OWNER2}', 'شركة دفعت', 'paid-co', 'verified');
  insert into company_members (company_id, user_id, role) values ('${COMPANY}', '${RECRUITER}', 'recruiter');
`);
const job = async (company, slug, status = 'active') =>
  (await one(`
    insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band,
                      district_id, commission_type, leads_source, description_ar, status, published_at, expires_at)
    values ('${company}', 'وظيفة ${slug}', '${slug}', 'primary', 'full_time', 'junior_1_3',
            (select id from districts limit 1), 'none', 'company_provided', 'وصف', '${status}', now(), now() + interval '30 days')
    returning id`)).id;
const live = await job(COMPANY, 'closing-live');
const old = await job(COMPANY, 'closing-old');
const paidJob = await job(PAID, 'paid-live');
const apply = async (jobId) =>
  (await one(`insert into applications (job_id, candidate_id, experience_band) values ('${jobId}', '${CANDIDATE}', 'junior_1_3') returning id`)).id;
await apply(live);
await apply(old);
await apply(paidJob);

report.section('handing over, only to a member');
const byRecruiter = await as(RECRUITER, `select public.transfer_company_ownership('${RECRUITER}') as r`);
report.check('a member who is not the owner cannot', byRecruiter.rows?.[0]?.r === 'not_owner', byRecruiter.error);
const toOutsider = await as(OWNER, `select public.transfer_company_ownership('${OUTSIDER}') as r`);
report.check('nobody outside the team can be given it', toOutsider.rows?.[0]?.r === 'not_member', toOutsider.error);
const direct = await as(OWNER, `update companies set owner_id = '${RECRUITER}' where id = '${COMPANY}'`);
report.check('the row cannot be moved by hand', !direct.ok);
const handed = await commitAs(OWNER, `select public.transfer_company_ownership('${RECRUITER}') as r`);
const after = await one(`
  select (select owner_id from companies where id = '${COMPANY}') as owner,
         (select role from company_members where company_id = '${COMPANY}' and user_id = '${RECRUITER}') as role,
         (select role from company_members where company_id = '${COMPANY}' and user_id = '${OWNER}') as was`);
report.check('the owner hands it to a member', handed.ok && handed.rows[0].r === 'ok' && after.owner === RECRUITER, handed.error);
report.check('who becomes an admin, the former owner staying one', after.role === 'admin' && after.was === 'admin');
const back = await commitAs(RECRUITER, `select public.transfer_company_ownership('${OWNER}') as r`);
report.check('and the new owner may hand it back', back.ok && back.rows[0].r === 'ok', back.error);

report.section('closing, hidden at once');
const notOwner = await as(RECRUITER, `select public.request_company_deletion() as r`);
report.check('only the owner may ask', notOwner.rows?.[0]?.r === 'not_owner', notOwner.error);
const asked = await commitAs(OWNER, `select public.request_company_deletion() as r`);
report.check('the owner asks', asked.ok && asked.rows[0].r === 'ok', asked.error);
const state = await one(`select deletion_requested_at is not null as asked, hiring_status, public.company_suspended(id) as hidden from companies where id = '${COMPANY}'`);
report.check('the company is hidden from the public page and paused', state.asked && state.hidden && state.hiring_status === 'paused');
report.check('its live listing closed', (await one(`select status from jobs where id = '${live}'`)).status === 'closed');
const resubmit = await as(OWNER, `update jobs set status = 'pending_review' where id = '${live}'`);
report.check('nothing goes up for review while it closes', !resubmit.ok && /company_closing/.test(resubmit.error ?? ''), resubmit.error);
const byHand = await as(OWNER, `update companies set deletion_requested_at = null where id = '${COMPANY}'`);
report.check('the request is not cleared by hand', !byHand.ok);
const transferWhileClosing = await as(OWNER, `select public.transfer_company_ownership('${RECRUITER}') as r`);
report.check('nor handed over while closing', transferWhileClosing.rows?.[0]?.r === 'closing');

report.section('changing one’s mind');
const cancelled = await commitAs(OWNER, `select public.cancel_company_deletion() as r`);
const back2 = await one(`select deletion_requested_at from companies where id = '${COMPANY}'`);
report.check('the owner cancels, and the company is back', cancelled.ok && cancelled.rows[0].r === 'ok' && back2.deletion_requested_at === null, cancelled.error);

report.section('the 14th day');
await db.exec(`update companies set deletion_requested_at = now() - interval '13 days' where id = '${COMPANY}'`);
await one(`select public.close_due_companies() as r`);
report.check('on the 13th day nothing goes', (await one(`select count(*)::int as n from companies where id = '${COMPANY}'`)).n === 1);
await db.exec(`update companies set deletion_requested_at = now() - interval '15 days' where id = '${COMPANY}'`);
const ran = await one(`select public.close_due_companies() as r`);
report.check('after the 14th it is deleted', ran.r.deleted === 1 && (await one(`select count(*)::int as n from companies where id = '${COMPANY}'`)).n === 0, JSON.stringify(ran.r));
const records = (await db.query(`select * from application_records where candidate_id = '${CANDIDATE}' order by id`)).rows;
report.check('the candidate keeps a record of each application that went', records.length === 2 && records.every((r) => r.reason === 'company_deleted' && r.company_name_ar === 'شركة تغلق'));
const theirs = await as(CANDIDATE, `select id from application_records`);
report.check('which they read', theirs.rows.length === 2, theirs.error);
const others = await as(OWNER2, `select id from application_records`);
report.check('and nobody else does', others.ok && others.rows.length === 0);

report.section('a company that was paid for is closed, not deleted');
await db.exec(`insert into orders (company_id, pack_key, credits, amount_egp, status) values ('${PAID}', 'single', 1, 300, 'paid')`);
await commitAs(OWNER2, `select public.request_company_deletion()`);
await db.exec(`update companies set deletion_requested_at = now() - interval '15 days' where id = '${PAID}'`);
const closed = await one(`select public.close_due_companies() as r`);
const row = await one(`select closed_at is not null as closed, about_ar, (select count(*)::int from company_members where company_id = '${PAID}') as members, (select count(*)::int from jobs where company_id = '${PAID}') as jobs, (select count(*)::int from orders where company_id = '${PAID}') as orders from companies where id = '${PAID}'`);
report.check('the row stays, closed, for its orders', closed.r.closed === 1 && row?.closed && row.orders === 1, JSON.stringify(closed.r));
report.check('with only its owner on it, and no listings', row?.members === 1 && row?.jobs === 0);
report.check('and its applicant keeps a record', (await one(`select count(*)::int as n from application_records where company_name_ar = 'شركة دفعت'`)).n === 1);

report.section('a company may clear its closed listings’ applications');
const KEEPER = 'aeaeaeae-3333-0000-0000-000000000003';
await db.exec(`insert into companies (id, owner_id, name_ar, slug, verification_status, purge_closed_after_days) values ('${KEEPER}', '${OUTSIDER}', 'شركة ترتّب', 'tidy-co', 'verified', 30)`);
const ended = await job(KEEPER, 'tidy-ended');
const still = await job(KEEPER, 'tidy-live');
const endedApp = await apply(ended);
const stillApp = await apply(still);
await db.exec(`update jobs set status = 'closed' where id = '${ended}'`);
report.check('closing a listing stamps when it ended', Boolean((await one(`select ended_at from jobs where id = '${ended}'`)).ended_at));
// Forty days on: the stamp moved back as the clock would have.
await db.exec(`alter table jobs disable trigger jobs_06_stamp_ended; update jobs set ended_at = now() - interval '40 days' where id = '${ended}'; alter table jobs enable trigger jobs_06_stamp_ended;`);
const tidied = await one(`select public.close_due_companies() as r`);
report.check("an application to a listing closed longer than the company's period goes", tidied.r.purged === 1 && !(await one(`select id from applications where id = '${endedApp}'`)), JSON.stringify(tidied.r));
report.check('one to a live listing stays', Boolean(await one(`select id from applications where id = '${stillApp}'`)));
report.check('and the candidate keeps a record of it', (await one(`select count(*)::int as n from application_records where reason = 'company_purged'`)).n === 1);
const badPeriod = await db.query(`update companies set purge_closed_after_days = 7 where id = '${KEEPER}'`).then(() => true, () => false);
report.check('only the offered periods are taken', badPeriod === false);

process.exit(report.finish() ? 0 : 1);
