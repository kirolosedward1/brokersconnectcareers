/**
 * Kept as long as the privacy policy says, and no longer (migration 338),
 * against the real migrations.
 * Run with: pnpm test:retention  (also part of pnpm test:db)
 *
 * What is pinned: an application goes a year after it was sent, with its CV
 * queued for deletion and nobody told it was withdrawn — while a candidate's
 * own withdrawal still tells the company; verification papers go a year after
 * a company stopped being verified (or after their review, if it never was),
 * never while it is verified and never while they wait for review; security
 * events, contact reveals and rate-limit counters go after their periods; every
 * period has a floor; and the date a company stopped being verified is the
 * database's to write.
 */
import { createTestDb, reporter } from './setup.mjs';

const report = reporter();
const db = await createTestDb();

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

const EMP = 'bbbbbbbb-1111-0000-0000-000000000001';
const EMP2 = 'bbbbbbbb-1111-0000-0000-000000000002';
const EMP3 = 'bbbbbbbb-1111-0000-0000-000000000003';
const CAND = 'bbbbbbbb-2222-0000-0000-000000000001';
const CAND2 = 'bbbbbbbb-2222-0000-0000-000000000002';
const CAND3 = 'bbbbbbbb-2222-0000-0000-000000000003';
const COMPANY = 'bbbbbbbb-3333-0000-0000-000000000001';
const OTHER = 'bbbbbbbb-3333-0000-0000-000000000002';
const VERIFIED = 'bbbbbbbb-3333-0000-0000-000000000003';

async function user(id, role) {
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
      values ('${id}', '${id}@demo.test', now(), now(), now());
    insert into profiles (id, role, full_name, whatsapp_phone, approval_status)
      values ('${id}', '${role}', 'اختبار', '+201000000001', 'approved');
  `);
}

/** Rows as they would be after time passed: triggers that stamp "now" are off while they are written. */
async function back(sql) {
  await db.exec(`set session_replication_role = replica; ${sql}; set session_replication_role = origin;`);
}

await user(EMP, 'employer');
await user(EMP2, 'employer');
await user(EMP3, 'employer');
await user(CAND, 'candidate');
await user(CAND2, 'candidate');
await user(CAND3, 'candidate');
await db.exec(`
  insert into companies (id, owner_id, name_ar, slug, verification_status)
    values ('${COMPANY}', '${EMP}', 'شركة الحفظ', 'retention-test-co', 'unverified'),
           ('${OTHER}', '${EMP2}', 'شركة تانية', 'retention-test-other', 'unverified'),
           ('${VERIFIED}', '${EMP3}', 'شركة موثّقة', 'retention-test-verified', 'verified');
`);
const job = (
  await one(`
    insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band,
                      district_id, commission_type, leads_source, description_ar, status,
                      published_at, expires_at)
    values ('${COMPANY}', 'وظيفة', 'retention-job', 'primary', 'full_time', 'junior_1_3',
            (select id from districts limit 1), 'none', 'company_provided', 'وصف', 'active',
            now() - interval '1 day', now() + interval '29 days')
    returning id`)
).id;

report.section('applications, a year after they were sent');
{
  await back(`
    insert into applications (job_id, candidate_id, status, cv_path, created_at)
      values ('${job}', '${CAND}', 'shortlisted', '${CAND}/old-cv.pdf', now() - interval '366 days'),
             ('${job}', '${CAND2}', 'new', null, now() - interval '364 days')
  `);
  const before = Number((await one(`select count(*) as n from notifications where kind = 'application_withdrawn'`)).n);

  const run = (await one(`select public.run_privacy_retention() as r`)).r;
  report.check('the run reports what it did, and no errors', run.applications === 1 && run.errors.length === 0, JSON.stringify(run));

  const left = await q(`select candidate_id from applications where job_id = '${job}' order by candidate_id`);
  report.check('the one past a year is gone, the one inside it stays',
    left.length === 1 && left[0].candidate_id === CAND2, JSON.stringify(left));

  const after = Number((await one(`select count(*) as n from notifications where kind = 'application_withdrawn'`)).n);
  report.check('and nobody is told it was withdrawn', after === before, `${before} → ${after}`);

  const cv = await one(`select count(*)::int as n from storage_gc_queue where path = '${CAND}/old-cv.pdf'`);
  report.check('its CV is queued for deletion', cv.n === 1);

  const setting = await one(`select coalesce(current_setting('app.retention_purge', true), '') as v`);
  report.check('the purge leaves nothing switched on behind it', setting.v !== 'on', setting.v);
}

report.section('a withdrawal is still a withdrawal');
{
  await db.exec(`insert into applications (job_id, candidate_id, status) values ('${job}', '${CAND3}', 'new')`);
  await db.exec(`update applications set status = 'shortlisted' where job_id = '${job}' and candidate_id = '${CAND3}'`);
  const before = Number((await one(`select count(*) as n from notifications where kind = 'application_withdrawn'`)).n);
  await db.exec(`delete from applications where job_id = '${job}' and candidate_id = '${CAND3}'`);
  const after = Number((await one(`select count(*) as n from notifications where kind = 'application_withdrawn'`)).n);
  report.check('a shortlisted candidate leaving still tells the company', after > before, `${before} → ${after}`);
}

report.section('verification papers');
{
  // When the company stopped being verified is the database's to write.
  await db.exec(`update companies set verification_status = 'verified' where id = '${OTHER}'`);
  report.check('a verified company has no end date', (await one(`select verification_ended_at from companies where id = '${OTHER}'`)).verification_ended_at === null);
  await db.exec(`update companies set verification_status = 'rejected' where id = '${OTHER}'`);
  const ended = (await one(`select verification_ended_at from companies where id = '${OTHER}'`)).verification_ended_at;
  report.check('one that stops being verified is dated then', ended !== null && Math.abs(Date.now() - new Date(ended).getTime()) < 60_000, String(ended));
  await tryExec(`update companies set verification_ended_at = '2001-01-01' where id = '${OTHER}'`);
  const kept = (await one(`select verification_ended_at from companies where id = '${OTHER}'`)).verification_ended_at;
  report.check('and nobody re-dates it', new Date(kept).getTime() === new Date(ended).getTime(), String(kept));

  await back(`
    insert into company_documents (company_id, doc_type, storage_path, status, reviewed_at, created_at) values
      ('${COMPANY}', 'commercial_register', '${COMPANY}/old-rejected.pdf', 'rejected', now() - interval '400 days', now() - interval '401 days'),
      ('${COMPANY}', 'tax_card', '${COMPANY}/old-pending.pdf', 'pending', null, now() - interval '400 days'),
      ('${COMPANY}', 'tax_card', '${COMPANY}/recent-rejected.pdf', 'rejected', now() - interval '20 days', now() - interval '21 days'),
      ('${VERIFIED}', 'commercial_register', '${VERIFIED}/old-verified.pdf', 'verified', now() - interval '900 days', now() - interval '901 days'),
      ('${OTHER}', 'commercial_register', '${OTHER}/recently-unverified.pdf', 'verified', now() - interval '900 days', now() - interval '901 days')
  `);

  const run = (await one(`select public.run_privacy_retention() as r`)).r;
  const paths = (await q(`select storage_path from company_documents order by storage_path`)).map((row) => row.storage_path);
  report.check('reviewed papers of an unverified company go a year after their review',
    !paths.includes(`${COMPANY}/old-rejected.pdf`) && run.company_documents === 1, JSON.stringify(run));
  report.check('papers waiting for review are never touched', paths.includes(`${COMPANY}/old-pending.pdf`));
  report.check('nor recent ones', paths.includes(`${COMPANY}/recent-rejected.pdf`));
  report.check('nor a verified company’s', paths.includes(`${VERIFIED}/old-verified.pdf`));
  report.check('nor those of a company that stopped being verified less than a year ago', paths.includes(`${OTHER}/recently-unverified.pdf`));
  const queued = await one(`select count(*)::int as n from storage_gc_queue where path = '${COMPANY}/old-rejected.pdf'`);
  report.check('the deleted paper’s file is queued for deletion', queued.n === 1);
}

report.section('companies that stopped being verified before the date was kept');
{
  /*
    As production stands before this migration: no end date on any company,
    whatever its history. One that lost its verification ten days ago (the
    audit trail says when), one whose papers were approved but whose loss
    predates the trail, and one never verified. Then 338 again, as it would
    run there.
  */
  const LOGGED = 'bbbbbbbb-3333-0000-0000-000000000011';
  const UNLOGGED = 'bbbbbbbb-3333-0000-0000-000000000012';
  const NEVER = 'bbbbbbbb-3333-0000-0000-000000000013';
  const owners = ['bbbbbbbb-1111-0000-0000-000000000011', 'bbbbbbbb-1111-0000-0000-000000000012', 'bbbbbbbb-1111-0000-0000-000000000013'];
  for (const owner of owners) await user(owner, 'employer');
  await back(`
    insert into companies (id, owner_id, name_ar, slug, verification_status, verification_ended_at) values
      ('${LOGGED}', '${owners[0]}', 'شركة فقدت التوثيق', 'retention-lost-logged', 'rejected', null),
      ('${UNLOGGED}', '${owners[1]}', 'شركة فقدته قديماً', 'retention-lost-unlogged', 'unverified', null),
      ('${NEVER}', '${owners[2]}', 'شركة لم تُوثَّق', 'retention-never', 'rejected', null);
    insert into audit_events (action, subject_type, subject_id, detail, occurred_at) values
      ('company_verification', 'company', '${LOGGED}', '{"from":"pending","to":"verified"}', now() - interval '500 days'),
      ('company_verification', 'company', '${LOGGED}', '{"from":"verified","to":"rejected"}', now() - interval '10 days');
    insert into company_documents (company_id, doc_type, storage_path, status, reviewed_at, created_at) values
      ('${LOGGED}', 'commercial_register', '${LOGGED}/approved.pdf', 'verified', now() - interval '400 days', now() - interval '401 days'),
      ('${UNLOGGED}', 'commercial_register', '${UNLOGGED}/approved.pdf', 'verified', now() - interval '400 days', now() - interval '401 days'),
      ('${NEVER}', 'commercial_register', '${NEVER}/refused.pdf', 'rejected', now() - interval '400 days', now() - interval '401 days')
  `);
  const notificationsBefore = Number((await one(`select count(*) as n from notifications`)).n);
  const versions = async () =>
    Object.fromEntries(
      (await q(`select id, version from companies where id in ('${LOGGED}', '${UNLOGGED}', '${NEVER}')`)).map((row) => [row.id, row.version]),
    );
  const versionsBefore = await versions();

  const { readFileSync } = await import('node:fs');
  const migration = readFileSync(new URL('../migrations/20260101000338_kept_as_long_as_the_policy_says.sql', import.meta.url), 'utf8');
  const applied = await tryExec(migration);
  report.check('338 runs again over a database that already has it', applied.ok, applied.error);

  const ended = Object.fromEntries(
    (await q(`select id, verification_ended_at from companies where id in ('${LOGGED}', '${UNLOGGED}', '${NEVER}')`)).map(
      (row) => [row.id, row.verification_ended_at && new Date(row.verification_ended_at).getTime()],
    ),
  );
  const daysAgo = (time) => (Date.now() - time) / 86_400_000;
  report.check('a loss the audit trail dates is dated then', ended[LOGGED] !== null && Math.abs(daysAgo(ended[LOGGED]) - 10) < 0.01, String(ended[LOGGED]));
  report.check('one it does not, for approved papers, is dated today', ended[UNLOGGED] !== null && Math.abs(daysAgo(ended[UNLOGGED])) < 0.01, String(ended[UNLOGGED]));
  report.check('a company never verified stays undated', ended[NEVER] === null, String(ended[NEVER]));
  const notificationsAfter = Number((await one(`select count(*) as n from notifications`)).n);
  report.check('dating them tells nobody anything', notificationsAfter === notificationsBefore, `${notificationsBefore} → ${notificationsAfter}`);
  // Nor edits them: a company's version is what tells an employer with its
  // form open that somebody else saved it.
  const versionsAfter = await versions();
  report.check('nor counts as an edit of the company', JSON.stringify(versionsAfter) === JSON.stringify(versionsBefore),
    `${JSON.stringify(versionsBefore)} → ${JSON.stringify(versionsAfter)}`);

  await db.query(`select public.run_privacy_retention()`);
  const paths = (await q(`select storage_path from company_documents where company_id in ('${LOGGED}', '${UNLOGGED}', '${NEVER}')`)).map((row) => row.storage_path);
  report.check('the papers of a company verified until ten days ago stay', paths.includes(`${LOGGED}/approved.pdf`), paths.join(', '));
  report.check('as do approved papers whose loss nobody dated', paths.includes(`${UNLOGGED}/approved.pdf`), paths.join(', '));
  report.check('a never-verified company’s papers still go a year after review', !paths.includes(`${NEVER}/refused.pdf`), paths.join(', '));

  // And the trigger is back: dating stays the database's.
  await db.exec(`update companies set verification_status = 'verified' where id = '${NEVER}'`);
  await db.exec(`update companies set verification_status = 'rejected' where id = '${NEVER}'`);
  const stamped = (await one(`select verification_ended_at from companies where id = '${NEVER}'`)).verification_ended_at;
  report.check('the trigger stamps again after the second run', stamped !== null && Math.abs(daysAgo(new Date(stamped).getTime())) < 0.01, String(stamped));
}

report.section('logs');
{
  await back(`
    insert into security_events (kind, created_at) values ('retention.old', now() - interval '366 days'), ('retention.new', now() - interval '10 days');
    insert into rate_limit_hits (bucket, created_at) values ('retention:old', now() - interval '3 days'), ('retention:new', now() - interval '1 hour')
  `);
  const agent = (await one(`select id from agent_profiles limit 1`)).id;
  await back(`
    insert into agent_contact_reveals (agent_id, viewer_id, created_at)
      values ('${agent}', '${EMP}', now() - interval '91 days'), ('${agent}', '${EMP}', now() - interval '2 days')
  `);

  await db.query(`select public.run_privacy_retention()`);
  const events = (await q(`select kind from security_events where kind like 'retention.%' order by kind`)).map((row) => row.kind);
  report.check('security events go after a year', events.join(',') === 'retention.new', events.join(','));
  const hits = (await q(`select bucket from rate_limit_hits where bucket like 'retention:%'`)).map((row) => row.bucket);
  report.check('rate-limit counters after two days', hits.join(',') === 'retention:new', hits.join(','));
  const reveals = await one(`select count(*)::int as n from agent_contact_reveals where viewer_id = '${EMP}'`);
  report.check('contact reveals after ninety days', reveals.n === 1);
}

report.section('every period has a floor');
{
  await db.exec(`update retention_policies set days = 1 where key = 'applications'`);
  await back(`insert into applications (job_id, candidate_id, status, created_at) values ('${job}', '${CAND}', 'new', now() - interval '10 days')`);
  await db.query(`select public.run_privacy_retention()`);
  const still = await one(`select count(*)::int as n from applications where job_id = '${job}' and candidate_id = '${CAND}'`);
  report.check('a mistyped period of one day still keeps a ten-day-old application', still.n === 1);
  await db.exec(`update retention_policies set days = 365 where key = 'applications'`);
}

report.section('who may run it');
{
  await db.exec('begin');
  let refused = false;
  try {
    await db.exec(`set local role authenticated; select public.run_privacy_retention();`);
  } catch {
    refused = true;
  }
  await db.exec('rollback');
  report.check('nobody signed in can run it', refused);
}

process.exit(report.finish() ? 0 : 1);
