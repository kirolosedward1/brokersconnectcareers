/**
 * A withdrawal keeps the row (migrations 361 and 362).
 *
 * The candidate, and only the candidate, marks a new or shortlisted
 * application withdrawn. The row, its events and the company's shortlist
 * notice stay. The CV path is cleared so the file can be released. A later
 * application is a new row. Counts of standing applications leave the
 * withdrawn one out.
 *
 * Run with: node supabase/tests/withdrawn.test.mjs
 */
import { createTestDb, runner, reporter } from './setup.mjs';

const db = await createTestDb();
const as = runner(db);
const report = reporter();

const q = async (sql) => (await db.query(sql)).rows;
const one = async (sql) => (await q(sql))[0];

/** Like `as`, but commits — a later assertion has to see the withdrawal. */
async function asCommit(userId, sql) {
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

const EMP = 'bbbbbbbb-1111-0000-0000-000000000001';
const CAND = 'bbbbbbbb-2222-0000-0000-000000000001';
const OTHER = 'bbbbbbbb-2222-0000-0000-000000000002';
const COMPANY = 'bbbbbbbb-3333-0000-0000-000000000001';
const CV = `${CAND}/withdrawn.pdf`;

async function user(id, role, name, phone) {
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
      values ('${id}', '${id}@demo.test', now(), now(), now());
    insert into profiles (id, role, full_name, whatsapp_phone)
      values ('${id}', '${role}', '${name}', '${phone}');
  `);
}

async function job(slug) {
  const row = await one(`
    insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band,
                      district_id, commission_type, leads_source, description_ar, status,
                      published_at, expires_at)
    values ('${COMPANY}', 'وظيفة ${slug}', '${slug}', 'primary', 'full_time', 'junior_1_3',
            (select id from districts limit 1), 'none', 'company_provided', 'وصف', 'active',
            now(), now() + interval '30 days')
    returning id`);
  return row.id;
}

await user(EMP, 'employer', 'صاحب الشركة', '+201099900001');
await user(CAND, 'candidate', 'مرشح', '+201099900002');
await user(OTHER, 'candidate', 'مرشح آخر', '+201099900003');
await db.exec(`
  update profiles set approval_status = 'approved' where id = '${EMP}';
  insert into companies (id, owner_id, name_ar, slug, verification_status)
    values ('${COMPANY}', '${EMP}', 'شركة الانسحاب', 'withdrawn-test-co', 'verified');
  insert into storage.objects (bucket_id, name, created_at)
    values ('cvs', '${CV}', now() - interval '3 days');
`);

const first = await job('wd-first');
const second = await job('wd-second');
const third = await job('wd-third');

const applied = await one(`
  insert into applications (job_id, candidate_id, status, cv_path)
  values ('${first}', '${CAND}', 'new', '${CV}')
  returning id`);

report.section('only the candidate, and only while it is open');

{
  const direct = await as(CAND, `update applications set status = 'withdrawn', withdrawn_at = now(), cv_path = null
                                  where id = '${applied.id}' returning id`);
  report.check('a candidate cannot withdraw by updating the row',
    direct.ok && direct.rows.length === 0, direct.error ?? `updated ${direct.rows.length}`);

  const steal = await as(EMP, `update applications set status = 'withdrawn', withdrawn_at = now(), cv_path = null
                                where id = '${applied.id}' returning id`);
  report.check('an employer cannot mark it withdrawn',
    !steal.ok && /closed/.test(steal.error ?? ''), steal.error ?? JSON.stringify(steal.rows));

  const receiptBefore = await one(`select count(*)::int as n from notifications
                                   where user_id = '${CAND}' and kind = 'application_submitted' and payload->>'job_id' = '${first}'`);
  report.check('applying leaves the candidate a receipt', receiptBefore.n === 1, String(receiptBefore.n));

  const stranger = await asCommit(OTHER, `select * from public.withdraw_application('${applied.id}')`);
  report.check('somebody else is refused, and the row is untouched',
    stranger.ok && stranger.rows.length === 0
      && (await one(`select status from applications where id = '${applied.id}'`)).status === 'new',
    stranger.error);

  const gone = await asCommit(CAND, `select application_id, previous_cv_path from public.withdraw_application('${applied.id}')`);
  report.check('the candidate withdraws a new application',
    gone.ok && gone.rows.length === 1 && gone.rows[0].previous_cv_path === CV, gone.error ?? JSON.stringify(gone.rows));

  const row = await one(`select status, withdrawn_at is not null as dated, cv_path from applications where id = '${applied.id}'`);
  report.check('the row stays, dated, with the file taken off it',
    row.status === 'withdrawn' && row.dated === true && row.cv_path === null, JSON.stringify(row));

  const event = await one(`select from_status, to_status from application_events
                            where application_id = '${applied.id}' and to_status = 'withdrawn'`);
  report.check('and the history records the withdrawal',
    event?.from_status === 'new' && event?.to_status === 'withdrawn', JSON.stringify(event));

  const queued = await one(`select reason from storage_gc_queue where bucket = 'cvs' and path = '${CV}'`);
  report.check('the CV is queued because the path changed, not because the row went',
    queued?.reason === 'replaced', JSON.stringify(queued));

  await db.exec(`update applications set cv_path = '${CV}' where id = '${applied.id}'`);
  const pinned = await one(`select public.cv_in_use('${CV}') as used`);
  report.check('a path left on a withdrawn row does not keep the file', pinned.used === false, JSON.stringify(pinned));
  await db.exec(`update applications set cv_path = null where id = '${applied.id}'`);

  const rewrite = await as(EMP, `update applications set decision_note = 'لا' where id = '${applied.id}' returning id`);
  report.check('an employer cannot rewrite a withdrawn application',
    !rewrite.ok && /closed/.test(rewrite.error ?? ''), rewrite.error ?? 'the update was allowed');

  const receipt = await one(`select count(*)::int as n from notifications
                              where user_id = '${CAND}' and kind = 'application_submitted' and payload->>'job_id' = '${first}'`);
  report.check('the candidate’s receipt for that listing goes with the withdrawal', receipt.n === 0, String(receipt.n));

  const told = await one(`select count(*)::int as n from notifications
                           where kind = 'application_withdrawn' and payload->>'job_id' = '${first}'`);
  report.check('a withdrawal from new does not tell the company', told.n === 0, String(told.n));
}

report.section('applying again is a new row');

{
  const again = await one(`
    insert into applications (job_id, candidate_id, status) values ('${first}', '${CAND}', 'new') returning id`);
  const both = await one(`select count(*)::int as n from applications where job_id = '${first}' and candidate_id = '${CAND}'`);
  report.check('the withdrawn application and the new one both exist',
    both.n === 2 && again.id !== applied.id, String(both.n));

  let blocked = false;
  let blockedError = '';
  try {
    await db.exec(`insert into applications (job_id, candidate_id, status) values ('${first}', '${CAND}', 'new')`);
  } catch (error) {
    blocked = true;
    blockedError = error.message;
  }
  report.check('a second standing application is still refused',
    blocked && /unique|duplicate/i.test(blockedError), blockedError || 'the insert was allowed');

  const summary = await as(CAND, `select public.candidate_summary() as s`);
  report.check('the candidate’s own count leaves the withdrawn one out',
    summary.ok && summary.rows[0].s.applications_total === 1, JSON.stringify(summary.rows[0]?.s ?? summary.error));
}

report.section('a shortlisted withdrawal is news; a decided application is not');

{
  const short = await one(`
    insert into applications (job_id, candidate_id, status) values ('${second}', '${CAND}', 'shortlisted') returning id`);
  const left = await asCommit(CAND, `select application_id from public.withdraw_application('${short.id}')`);
  const notices = await one(`select count(*)::int as n from notifications
                              where kind = 'application_withdrawn' and payload->>'job_id' = '${second}'`);
  report.check('leaving after being shortlisted tells the company',
    left.ok && left.rows.length === 1 && notices.n === 1, JSON.stringify({ left: left.rows, notices: notices.n, error: left.error }));

  const interview = await one(`
    insert into applications (job_id, candidate_id, status) values ('${third}', '${CAND}', 'interview') returning id`);
  const shut = await as(CAND, `select * from public.withdraw_application('${interview.id}')`);
  const still = await one(`select status from applications where id = '${interview.id}'`);
  report.check('an application past shortlisting cannot be withdrawn',
    shut.ok && shut.rows.length === 0 && still.status === 'interview', shut.error ?? still.status);
}

report.finish();
