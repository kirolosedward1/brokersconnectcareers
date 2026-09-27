/**
 * The data lifecycle: what happens to a row, and to the file behind it, when
 * the thing it describes ends.
 *
 * Migrations 203 and 204 against the real schema, in PGlite. Every fixture is
 * made here rather than borrowed from the seed, so each section says exactly
 * what state it starts from — the seed changes, and a lifecycle assertion that
 * passes because of a seed row nobody meant is worse than no assertion.
 *
 * Two workers racing is covered twice: here, sequentially, through the lease
 * and the idempotence of every step; and in lifecycle-concurrency.test.mjs
 * against a real Postgres with two connections, which is the only place the
 * advisory lock and `skip locked` can actually be seen to hold.
 */
import { createTestDb, runner, reporter, USERS } from './setup.mjs';

const db = await createTestDb();
const as = runner(db);
const report = reporter();

const q = async (sql) => (await db.query(sql)).rows;
const one = async (sql) => (await q(sql))[0];
const tryExec = async (sql) => {
  try {
    await db.exec(sql);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

// ----------------------------------------------------------------- fixtures --

const EMP = 'aaaaaaaa-1111-0000-0000-000000000001';
const CAND = 'aaaaaaaa-2222-0000-0000-000000000001';
const CAND2 = 'aaaaaaaa-2222-0000-0000-000000000002';
const COMPANY = 'aaaaaaaa-3333-0000-0000-000000000001';
const STORAGE = 'https://example.supabase.co/storage/v1/object/public';

async function user(id, role, name) {
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
      values ('${id}', '${id}@demo.test', now(), now(), now());
    insert into profiles (id, role, full_name, whatsapp_phone)
      values ('${id}', '${role}', '${name}', '+201000000001');
  `);
}

async function object(bucket, name, ageDays = 3) {
  await db.exec(`
    insert into storage.objects (bucket_id, name, created_at)
      values ('${bucket}', '${name}', now() - interval '${ageDays} days');
  `);
}

async function job(slug, { status = 'active', ageDays = 0 } = {}) {
  // Explicit dates on INSERT are kept as stated (migration 46), which is how
  // a listing that ended in the past is made without waiting thirty days.
  const published = `now() - interval '${ageDays} days'`;
  const row = await one(`
    insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band,
                      district_id, commission_type, leads_source, description_ar, status,
                      published_at, expires_at)
    values ('${COMPANY}', 'وظيفة ${slug}', '${slug}', 'primary', 'full_time', 'junior_1_3',
            (select id from districts limit 1), 'none', 'company_provided', 'وصف', '${status}',
            ${status === 'active' ? published : 'null'},
            ${status === 'active' ? `${published} + interval '30 days'` : 'null'})
    returning id`);
  return row.id;
}

await user(EMP, 'employer', 'صاحب الشركة');
await user(CAND, 'candidate', 'مرشح أول');
await user(CAND2, 'candidate', 'مرشح ثاني');
await db.exec(`
  update profiles set approval_status = 'approved' where id = '${EMP}';
  insert into companies (id, owner_id, name_ar, slug, verification_status)
    values ('${COMPANY}', '${EMP}', 'شركة الاختبار', 'lifecycle-test-co', 'verified');
`);

// ================================================================ stamps ====

report.section('state and its date move together');

{
  const co = await one(`select verified_at from companies where id = '${COMPANY}'`);
  report.check('a company inserted as verified is given its verified_at', co.verified_at !== null);

  await db.exec(`update companies set verification_status = 'rejected' where id = '${COMPANY}'`);
  const rejected = await one(`select verified_at from companies where id = '${COMPANY}'`);
  report.check('and loses it when it stops being verified', rejected.verified_at === null);
  await db.exec(`update companies set verification_status = 'verified' where id = '${COMPANY}'`);

  const bad = await tryExec(`update companies set verified_at = null where id = '${COMPANY}'`);
  report.check('a verified company cannot be left undated by hand', !bad.ok, bad.error);
}

// =========================================================== job expiry =====

report.section('a listing that runs out');

const expiredJob = await job('lc-expired', { ageDays: 31 });
const liveJob = await job('lc-live', { ageDays: 1 });

await db.exec(`
  insert into applications (job_id, candidate_id, status, cv_path)
    values ('${expiredJob}', '${CAND}', 'interview', '${CAND}/cv-for-expired.pdf');
`);

{
  const n = (await one(`select public.expire_stale_jobs(500) as n`)).n;
  const status = (await one(`select status from jobs where id = '${expiredJob}'`)).status;
  report.check('the sweep relabels it expired', status === 'expired' && n >= 1, `${status}, ${n}`);

  const live = (await one(`select status from jobs where id = '${liveJob}'`)).status;
  report.check('and leaves a listing with time left alone', live === 'active', live);

  const again = (await one(`select public.expire_stale_jobs(500) as n`)).n;
  report.check('a second run finds nothing to do', again === 0, String(again));

  const apply = await as(CAND2, `
    insert into applications (job_id, candidate_id, status)
      values ('${expiredJob}', '${CAND2}', 'new')`);
  report.check('it stops accepting applications', !apply.ok, apply.error);

  const history = await one(`select count(*)::int as n from applications where job_id = '${expiredJob}'`);
  report.check('the applications it already had are kept', history.n === 1);

  const employer = await as(EMP, `select id from jobs where id = '${expiredJob}'`);
  report.check('its employer can still read it', employer.ok && employer.rows.length === 1);

  const applicant = await as(CAND, `select status from jobs where id = '${expiredJob}'`);
  report.check('and so can the person who applied', applicant.ok && applicant.rows.length === 1);

  const board = await as(null, `
    select id from jobs where status = 'active' and expires_at > now() and id = '${expiredJob}'`, 'anon');
  report.check('it is gone from the board query', board.ok && board.rows.length === 0);

  const audit = await one(`
    select count(*)::int as n from audit_events
     where subject_id = '${expiredJob}' and action = 'job_status' and detail ->> 'to' = 'expired'`);
  report.check('and the expiry is on the audit trail', audit.n === 1);
}

{
  // Bounded: a backlog drains over several calls, each doing at most its limit.
  for (let i = 0; i < 7; i += 1) await job(`lc-backlog-${i}`, { ageDays: 40 });
  const firsts = [];
  for (let i = 0; i < 4; i += 1) firsts.push((await one(`select public.expire_stale_jobs(3) as n`)).n);
  report.check('the sweep takes at most its limit per call, and drains', JSON.stringify(firsts) === '[3,3,1,0]',
    JSON.stringify(firsts));
}

// ============================================================ job close =====

report.section('a listing the employer closes');

{
  const closing = await job('lc-close', { ageDays: 2 });
  await db.exec(`
    insert into applications (job_id, candidate_id, status) values ('${closing}', '${CAND2}', 'new');
  `);

  const closed = await as(EMP, `update jobs set status = 'closed' where id = '${closing}' returning status`);
  report.check('the owner can close it', closed.ok && closed.rows[0]?.status === 'closed', closed.error);

  await db.exec(`update jobs set status = 'closed' where id = '${closing}'`);
  const apps = await as(CAND2, `select a.id, j.status from applications a join jobs j on j.id = a.job_id
                                 where a.job_id = '${closing}'`);
  report.check('the applicant still sees their application and the listing',
    apps.ok && apps.rows[0]?.status === 'closed');

  const deleted = await tryExec(`delete from jobs where id = '${closing}'`);
  report.check('a listing somebody applied to cannot be deleted, even by the service role',
    !deleted.ok && /applications_job_id_fkey/.test(deleted.error), deleted.error);

  const empty = await job('lc-nobody-applied', { status: 'draft' });
  const gone = await tryExec(`delete from jobs where id = '${empty}'`);
  report.check('a draft nobody applied to can be', gone.ok, gone.error);
}

// ====================================================== withdrawal & CVs ====

report.section('withdrawing, and the CV it leaves behind');

{
  const target = liveJob;
  await object('cvs', `${CAND2}/withdrawn.pdf`);
  await db.exec(`
    insert into applications (job_id, candidate_id, status, cv_path)
      values ('${target}', '${CAND2}', 'new', '${CAND2}/withdrawn.pdf');
  `);

  const withdrawn = await as(CAND2, `delete from applications where job_id = '${target}' returning id`);
  report.check('a new application can be withdrawn', withdrawn.ok && withdrawn.rows.length === 1, withdrawn.error);

  await db.exec(`delete from applications where job_id = '${target}' and candidate_id = '${CAND2}'`);
  const queued = await one(`select reason, not_before > now() as waiting from storage_gc_queue
                             where bucket = 'cvs' and path = '${CAND2}/withdrawn.pdf'`);
  report.check('its CV is queued for deletion', queued?.reason === 'row_deleted');
  report.check('but not deletable yet — the grace period stands', queued?.waiting === true);

  const early = await q(`select * from public.claim_storage_gc(100) where path = '${CAND2}/withdrawn.pdf'`);
  report.check('a worker is not handed it before its date', early.length === 0);

  await db.exec(`update storage_gc_queue set not_before = now() - interval '1 minute'
                  where path = '${CAND2}/withdrawn.pdf'`);
  const due = await q(`select * from public.claim_storage_gc(100) where path = '${CAND2}/withdrawn.pdf'`);
  report.check('after it, a worker is', due.length === 1);

  // The other half of the pair, as the route would call it.
  await db.exec(`select public.finish_storage_gc('cvs', array['${CAND2}/withdrawn.pdf'], '{}', null)`);
  const finished = await one(`select outcome from storage_gc_queue where path = '${CAND2}/withdrawn.pdf'`);
  report.check('and recording the removal closes it', finished.outcome === 'removed');

  const shortlisted = await as(CAND, `delete from applications where job_id = '${expiredJob}' returning id`);
  report.check('an application past shortlisting cannot be withdrawn', shortlisted.ok && shortlisted.rows.length === 0);
}

report.section('replacing a CV that an application still uses');

{
  await object('cvs', `${CAND}/profile-v1.pdf`);
  await object('cvs', `${CAND}/profile-v2.pdf`);
  await db.exec(`
    insert into agent_profiles (user_id, slug, cv_path) values ('${CAND}', 'lc-cand', '${CAND}/profile-v1.pdf');
    insert into applications (job_id, candidate_id, status, cv_path)
      values ('${liveJob}', '${CAND}', 'new', '${CAND}/profile-v1.pdf');
    update agent_profiles set cv_path = '${CAND}/profile-v2.pdf' where user_id = '${CAND}';
    update storage_gc_queue set not_before = now() - interval '1 minute' where path = '${CAND}/profile-v1.pdf';
  `);

  const claimed = await q(`select * from public.claim_storage_gc(100) where path = '${CAND}/profile-v1.pdf'`);
  const row = await one(`select outcome from storage_gc_queue where path = '${CAND}/profile-v1.pdf'`);
  report.check('the old file is never handed out while an application points at it',
    claimed.length === 0 && row.outcome === 'kept_referenced', JSON.stringify(row));

  // The application is withdrawn later: the file is released a second time
  // and this time nothing is holding it.
  await db.exec(`delete from applications where job_id = '${liveJob}' and candidate_id = '${CAND}'`);
  const requeued = await one(`select outcome, done_at from storage_gc_queue where path = '${CAND}/profile-v1.pdf'`);
  report.check('once the last reference goes, it is queued again', requeued.outcome === null && requeued.done_at === null);
}

report.section('replacing a profile photo');

{
  const oldUrl = `${STORAGE}/avatars/${CAND2}/old.jpg`;
  await object('avatars', `${CAND2}/old.jpg`);
  await object('avatars', `${CAND2}/new.jpg`);
  await db.exec(`update profiles set avatar_url = '${oldUrl}' where id = '${CAND2}'`);
  await db.exec(`update profiles set avatar_url = '${STORAGE}/avatars/${CAND2}/new.jpg' where id = '${CAND2}'`);

  const q1 = await one(`select reason, not_before - queued_at as grace from storage_gc_queue
                         where bucket = 'avatars' and path = '${CAND2}/old.jpg'`);
  report.check('the previous photo is queued', q1?.reason === 'replaced');
  report.check('with the public grace period, for cached pages and emails',
    /7 days/.test(JSON.stringify(q1?.grace)) || q1?.grace?.days === 7, JSON.stringify(q1?.grace));

  const current = await one(`select public.storage_object_is_referenced('avatars', '${CAND2}/new.jpg') as r`);
  report.check('the current photo counts as referenced through its URL', current.r === true);

  const google = await tryExec(`update profiles set avatar_url = 'https://lh3.googleusercontent.com/a/x' where id = '${CAND2}'`);
  const external = await one(`select count(*)::int as n from storage_gc_queue where path like '%googleusercontent%'`);
  report.check('an external photo URL is never mistaken for one of ours', google.ok && external.n === 0);
}

// ====================================================== account deletion ====

report.section('deleting accounts');

{
  const owner = await tryExec(`delete from auth.users where id = '${EMP}'`);
  // Whichever refuses first — the foreign key, or migration 22's membership
  // guard met mid-cascade — the account and the company both survive. The
  // guard alone was not enough: it depends on the cascade reaching
  // company_members before companies, which Postgres does not promise.
  const stillThere = await one(`select count(*)::int as n from companies where id = '${COMPANY}'`);
  report.check('a company owner cannot be deleted out from under the company',
    !owner.ok && /companies_owner_id_fkey|company_owner_membership/.test(owner.error) && stillThere.n === 1,
    owner.error);

  // A candidate: everything that is theirs goes; what records the platform's
  // own conduct stays, without them.
  await db.exec(`
    insert into email_log (template, recipient, user_id, status)
      values ('application_receipt', 'someone@real.example', '${CAND}', 'sent');
    insert into notifications (user_id, kind, payload) values ('${CAND}', 'application_submitted', '{}');
  `);
  const before = await one(`select count(*)::int as n from applications where candidate_id = '${CAND}'`);

  const removed = await tryExec(`delete from auth.users where id = '${CAND}'`);
  report.check('a candidate can be deleted', removed.ok, removed.error);

  const after = await one(`
    select (select count(*) from profiles where id = '${CAND}')::int as profiles,
           (select count(*) from applications where candidate_id = '${CAND}')::int as apps,
           (select count(*) from notifications where user_id = '${CAND}')::int as notes,
           (select count(*) from agent_profiles where user_id = '${CAND}')::int as agent`);
  report.check('their profile, applications, notifications and directory card go',
    after.profiles + after.apps + after.notes + after.agent === 0 && before.n > 0, JSON.stringify(after));

  const mail = await one(`select recipient, user_id from email_log where template = 'application_receipt'
                            and recipient not like '%@demo.test' order by created_at desc limit 1`);
  report.check('the delivery record stays, without their address',
    mail.recipient === 'redacted@account-deleted.invalid' && mail.user_id === null, JSON.stringify(mail));

  const cvs = await q(`select path, reason from storage_gc_queue where path like '${CAND}/%' and done_at is null`);
  report.check('every CV they had is queued for deletion', cvs.length >= 1, JSON.stringify(cvs));

  const tomb = await one(`select count(*)::int as n from audit_events where subject_id = '${CAND}' and action = 'account_deleted'`);
  report.check('and the deletion itself is on the audit trail', tomb.n === 1);

  const leftAudit = await one(`select count(*)::int as n from audit_events where subject_id = '${expiredJob}'`);
  report.check('the listing history they touched is untouched', leftAudit.n >= 1);
}

{
  // An admin who reviewed something could never be deleted: the audit
  // columns had no ON DELETE and refused.
  const REVIEWER = 'aaaaaaaa-4444-0000-0000-000000000001';
  await user(REVIEWER, 'candidate', 'مراجع');
  await db.exec(`
    update profiles set role = 'admin' where id = '${REVIEWER}';
    insert into reports (job_id, reporter_id, reason) values ('${liveJob}', '${CAND2}', 'spam');
    update reports set resolved = true, resolved_by = '${REVIEWER}' where job_id = '${liveJob}';
  `);
  const stamped = await one(`select resolved_at from reports where job_id = '${liveJob}'`);
  report.check('resolving a report dates it', stamped.resolved_at !== null);

  const gone = await tryExec(`delete from auth.users where id = '${REVIEWER}'`);
  const kept = await one(`select resolved, resolved_by from reports where job_id = '${liveJob}'`);
  report.check('an admin who resolved a report can be deleted', gone.ok, gone.error);
  report.check('and the resolution stays, unattributed', kept.resolved === true && kept.resolved_by === null);
}

// ===================================================== company suspension ===

report.section('suspending a company');

{
  const ADMIN = USERS.admin;
  const suspendedJob = await job('lc-suspended', { ageDays: 1 });
  await db.exec(`insert into applications (job_id, candidate_id, status) values ('${suspendedJob}', '${CAND2}', 'new')`);

  const r = await as(ADMIN, `select public.set_account_approval('${EMP}', 'rejected', 'اختبار')`);
  report.check('an admin suspends the only member', r.ok, r.error);

  await db.exec(`
    select set_config('request.jwt.claim.sub', '${ADMIN}', false);
    select public.set_account_approval('${EMP}', 'rejected', 'اختبار');
    select set_config('request.jwt.claim.sub', '', false);
  `);

  const status = (await one(`select status from jobs where id = '${suspendedJob}'`)).status;
  report.check('the company\'s live listing comes down', status === 'rejected', status);

  const apps = await one(`select count(*)::int as n from applications where job_id = '${suspendedJob}'`);
  report.check('the applications to it are kept', apps.n === 1);

  const audit = await one(`select actor_id, detail from audit_events
                            where subject_id = '${EMP}' and action = 'account_approval'
                            order by id desc limit 1`);
  report.check('the suspension is on the audit trail with who did it',
    audit?.actor_id === ADMIN && audit.detail.to === 'rejected', JSON.stringify(audit));

  await db.exec(`update profiles set approval_status = 'approved' where id = '${EMP}'`);
}

// ================================================== missing relationships ===

report.section('finding what is broken, and repairing only what is safe');

{
  await db.exec(`
    alter table company_members disable trigger company_members_10_guard;
    delete from company_members where company_id = '${COMPANY}' and user_id = '${EMP}';
    alter table company_members enable trigger company_members_10_guard;
  `);
  await object('company-logos', `${COMPANY}/never-saved.png`);
  await job('lc-stale-label', { ageDays: 45 });

  const rows = await q(`select * from public.lifecycle_integrity_report()`);
  const found = Object.fromEntries(rows.map((r) => [r.check_name, Number(r.found)]));
  report.check('the report finds the owner who lost their membership', found.company_owner_not_admin_member === 1);
  report.check('and the listing whose label lags its date', found.active_job_past_expiry >= 1);
  report.check('and the file nothing points at', found.unreferenced_file_not_queued >= 1);
  report.check('and says the maintenance job has not run', found.maintenance_not_run_in_26h === 1);

  const stranger = await as(CAND2, `select * from public.lifecycle_integrity_report()`);
  report.check('a non-admin cannot read it', !stranger.ok && /forbidden/.test(stranger.error));

  const dry = await q(`select * from public.repair_lifecycle_integrity(false)`);
  const still = await one(`select count(*)::int as n from company_members where company_id = '${COMPANY}' and user_id = '${EMP}'`);
  report.check('a dry run reports and changes nothing',
    still.n === 0 && dry.every((r) => r.applied === false), JSON.stringify(dry));

  await q(`select * from public.repair_lifecycle_integrity(true)`);
  const after = Object.fromEntries(
    (await q(`select * from public.lifecycle_integrity_report()`)).map((r) => [r.check_name, Number(r.found)]),
  );
  report.check('applying it restores the membership, the label and the queue',
    after.company_owner_not_admin_member === 0 && after.active_job_past_expiry === 0
      && after.unreferenced_file_not_queued === 0, JSON.stringify(after));

  const logo = await one(`select reason from storage_gc_queue where path = '${COMPANY}/never-saved.png'`);
  report.check('the orphan is queued, not deleted', logo?.reason === 'orphan_scan');
}

// ================================================ cleanup retry & workers ===

report.section('a cleanup that fails, and two that start at once');

{
  const path = `${CAND2}/retry.pdf`;
  await object('cvs', path);
  await db.exec(`
    insert into storage_gc_queue (bucket, path, reason, not_before)
      values ('cvs', '${path}', 'orphan_scan', now() - interval '1 minute');
  `);

  const first = await q(`select * from public.claim_storage_gc(500) where path = '${path}'`);
  const second = await q(`select * from public.claim_storage_gc(500) where path = '${path}'`);
  report.check('a second worker is not handed what the first is holding', first.length === 1 && second.length === 0);

  await db.exec(`select public.finish_storage_gc('cvs', '{}', array['${path}'], 'storage 503')`);
  const failed = await one(`select attempts, last_error, done_at from storage_gc_queue where path = '${path}'`);
  report.check('a failed removal is recorded and left open', failed.done_at === null && failed.last_error === 'storage 503');

  const retried = await q(`select * from public.claim_storage_gc(500) where path = '${path}'`);
  report.check('and is handed out again', retried.length === 1);

  for (let i = 0; i < 5; i += 1) {
    await db.exec(`select public.finish_storage_gc('cvs', '{}', array['${path}'], 'storage 503')`);
    await q(`select * from public.claim_storage_gc(500)`);
  }
  const exhausted = await one(`select attempts from storage_gc_queue where path = '${path}'`);
  const noMore = await q(`select * from public.claim_storage_gc(500) where path = '${path}'`);
  report.check('until five attempts are spent, and then it stops', exhausted.attempts === 5 && noMore.length === 0,
    String(exhausted.attempts));

  const flagged = Number((await one(`select found from public.lifecycle_integrity_report()
                                      where check_name = 'storage_cleanup_exhausted'`)).found);
  report.check('where the report shows it to a person', flagged >= 1);

  const gonePath = `${CAND2}/already-gone.pdf`;
  await db.exec(`insert into storage_gc_queue (bucket, path, reason, not_before)
                   values ('cvs', '${gonePath}', 'row_deleted', now() - interval '1 minute')`);
  await q(`select * from public.claim_storage_gc(500)`);
  const missing = await one(`select outcome from storage_gc_queue where path = '${gonePath}'`);
  report.check('a file already gone is closed without an API call', missing.outcome === 'missing');
}

// ======================================================== the whole run =====

report.section('one maintenance run');

{
  await db.exec(`
    insert into notifications (user_id, kind, payload, read_at, created_at) values
      ('${CAND2}', 'application_submitted', '{}', now() - interval '200 days', now() - interval '200 days'),
      ('${CAND2}', 'application_submitted', '{}', null,                       now() - interval '200 days'),
      ('${CAND2}', 'application_submitted', '{}', null,                       now() - interval '400 days');
  `);
  const agent = await one(`insert into agent_profiles (user_id, slug) values ('${CAND2}', 'lc-cand2') returning id`);
  await db.exec(`
    insert into agent_profile_views (agent_id, company_id, day) values
      ('${agent.id}', '${COMPANY}', current_date - 90),
      ('${agent.id}', '${COMPANY}', current_date - 5);
  `);
  const auditBefore = (await one(`select count(*)::int as n from audit_events`)).n;

  const run = (await one(`select public.run_lifecycle_maintenance() as r`)).r;
  report.check('it completes cleanly', run.status === 'ok', JSON.stringify(run));

  const notes = await q(`select read_at is not null as read, extract(day from now() - created_at)::int as age
                           from notifications where user_id = '${CAND2}' and created_at < now() - interval '100 days'`);
  report.check('an old read notification is pruned, an unread one inside its year is kept',
    notes.length === 1 && notes[0].read === false && notes[0].age < 365, JSON.stringify(notes));

  const views = await q(`select day from agent_profile_views where agent_id = '${agent.id}'`);
  report.check('profile views past sixty days go, recent ones stay', views.length === 1);

  const auditAfter = (await one(`select count(*)::int as n from audit_events`)).n;
  report.check('the audit trail is never pruned', auditAfter >= auditBefore);

  const logged = await one(`select status, processed from maintenance_runs where id = ${run.run_id}`);
  report.check('the run is logged with what it did',
    logged.status === 'ok' && 'notifications_pruned' in logged.processed, JSON.stringify(logged));

  const second = (await one(`select public.run_lifecycle_maintenance() as r`)).r;
  report.check('a second run straight after does nothing',
    second.status === 'ok' && second.jobs_expired === 0 && second.notifications_pruned === 0
      && second.profile_views_pruned === 0, JSON.stringify(second));

  const emailKept = (await one(`select count(*)::int as n from email_log`)).n;
  report.check('email_log is untouched while its period is undecided', emailKept >= 1);

  const abandoned = await q(`select * from public.abandoned_signups(100)`);
  report.check('abandoned signups are never listed while their period is undecided', abandoned.length === 0);

  const healthy = Number((await one(`select found from public.lifecycle_integrity_report()
                                      where check_name = 'maintenance_not_run_in_26h'`)).found);
  report.check('and the report now sees a recent run', healthy === 0);
}

// ============================================================ permissions ===

report.section('who may call any of this');

for (const fn of [
  'run_lifecycle_maintenance()',
  'claim_storage_gc(10)',
  "finish_storage_gc('cvs', '{}', '{}', null)",
  'expire_stale_jobs(1)',
  'queue_storage_orphans(1)',
  'abandoned_signups(1)',
]) {
  const anon = await as(null, `select public.${fn}`, 'anon');
  const signedIn = await as(CAND2, `select public.${fn}`);
  report.check(`${fn.split('(')[0]}: neither anon nor a signed-in user`, !anon.ok && !signedIn.ok);
}

for (const table of ['audit_events', 'maintenance_runs', 'storage_gc_queue', 'retention_policies']) {
  const r = await as(CAND2, `select count(*)::int as n from ${table}`);
  report.check(`${table} reads as empty to a non-admin`, r.ok && r.rows[0].n === 0, r.error);
}

// The integrity report and its repair are for a person at the console, so a
// signed-in session reaches them and the guard inside decides. Owning a
// company makes nobody a platform admin. Anon is stopped by the grant, before
// the guard is ever asked.
{
  const REPORT = 'select * from public.lifecycle_integrity_report()';
  const REPAIR = (apply) => `select * from public.repair_lifecycle_integrity(${apply})`;
  const refused = (r) => !r.ok && /forbidden/.test(r.error);

  for (const [who, id] of [['a candidate', CAND2], ['an employer who owns a company', EMP]]) {
    report.check(`${who} is refused the integrity report`, refused(await as(id, REPORT)));
    report.check(`${who} is refused a repair, dry run or not`,
      refused(await as(id, REPAIR(false))) && refused(await as(id, REPAIR(true))));
  }

  for (const [what, sql] of [['report', REPORT], ['repair', REPAIR(false)]]) {
    const anon = await as(null, sql, 'anon');
    report.check(`anon cannot execute the ${what} at all`, !anon.ok && /permission denied/.test(anon.error), anon.error);
  }

  const admin = await as(USERS.admin, REPORT);
  report.check('a signed-in admin runs the report through the API role', admin.ok && admin.rows.length > 0, admin.error);

  const dry = await as(USERS.admin, REPAIR(false));
  report.check('and a repair dry run, which applies nothing',
    dry.ok && dry.rows.length > 0 && dry.rows.every((r) => r.applied === false), dry.error);
}

process.exit(report.finish() ? 0 : 1);
