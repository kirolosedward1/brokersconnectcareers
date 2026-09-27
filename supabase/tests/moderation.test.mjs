/**
 * Moderation and user safety, exercised as each kind of user.
 *
 * Migrations 207–210: reports that are evidence and cannot be used as a
 * weapon, signals that tell a moderator what to look at without deciding
 * anything, a live listing whose text cannot change unseen, and an appeal for
 * every decision somebody can be on the wrong end of.
 *
 * The questions are the ones the brief listed — report spam, the same report
 * twice, a report about a listing that was then deleted, a suspended
 * employer, a takedown and its undoing, a candidate's report, who may reach
 * the levers, two moderators on one case — and the ones a scammer would ask:
 * can I read the patterns, can I edit the scam in after approval, can I see
 * who reported me.
 *
 * Run with: pnpm test:moderation (also part of pnpm test:db)
 */
import { createTestDb, runner, reporter, FIXTURES, USERS } from './setup.mjs';

const report = reporter();
const db = await createTestDb();
const as = runner(db);

const { employerVerified, employerUnverified, candidate, publicAgent, admin } = FIXTURES;
const candidate3 = USERS.candidate3;
const candidate4 = USERS.candidate4;
const candidate6 = USERS.candidate6;
const candidate7 = USERS.candidate7;
const employer3 = USERS.employer3;

const one = async (sql) => (await db.query(sql)).rows[0];
const all = async (sql) => (await db.query(sql)).rows;

/** Several statements as one user in one transaction, rolled back afterwards. */
async function session(userId, fn, role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role};`);
    if (userId) {
      await db.exec(`set local request.jwt.claim.sub = '${userId}';`);
      await db.exec(`set local request.jwt.claims = '{"role":"${role}","sub":"${userId}"}';`);
    } else {
      await db.exec(`set local request.jwt.claims = '{"role":"${role}"}';`);
    }
    const q = async (sql) => (await db.query(sql)).rows;
    /*
      A statement expected to fail, inside the same transaction. Postgres
      aborts a transaction at its first error, so the probe runs under a
      savepoint and rolls back to it: the refusal is returned and the rest of
      the session carries on. Null when the statement succeeded.
    */
    q.probe = async (sql) => {
      await db.exec('savepoint probe');
      try {
        await db.query(sql);
        await db.exec('release savepoint probe');
        return null;
      } catch (error) {
        await db.exec('rollback to savepoint probe');
        return error.message;
      }
    };
    return { ok: true, value: await fn(q) };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    await db.exec('rollback');
  }
}

/** One statement as a user, committed — setup that later probes depend on. */
async function persist(userId, sql) {
  await db.exec('begin');
  try {
    await db.exec('set local role authenticated;');
    await db.exec(`set local request.jwt.claim.sub = '${userId}';`);
    await db.exec(`set local request.jwt.claims = '{"role":"authenticated","sub":"${userId}"}';`);
    const rows = (await db.query(sql)).rows;
    await db.exec('commit');
    return { ok: true, rows };
  } catch (error) {
    await db.exec('rollback');
    return { ok: false, error: error.message, rows: [] };
  }
}

// Every demo profile is created as the suite starts, which makes all of them
// "new accounts". Most checks here are not about that limit, so the accounts
// are aged; the one check that is creates its own.
await db.exec(`update profiles set created_at = now() - interval '90 days'`);

const rowad = (await one(`select company_id as id from company_members where user_id = '${employerVerified}' limit 1`)).id;
const hub = (await one(`select company_id as id from company_members where user_id = '${employerUnverified}' limit 1`)).id;
const capital = (await one(`select company_id as id from company_members where user_id = '${employer3}' limit 1`)).id;
const district = (await one('select id from districts order by id limit 1')).id;
const gatedAgent = (await one(`select id from agent_profiles where user_id = '${candidate}'`)).id;

let serial = 0;
async function makeJob(companyId, status = 'active', fields = {}) {
  serial += 1;
  const slug = `moderation-test-${serial}-${Math.random().toString(36).slice(2, 7)}`;
  const cols = {
    company_id: `'${companyId}'`,
    title_ar: `'${fields.title_ar ?? 'مسؤول مبيعات عقارية'}'`,
    slug: `'${slug}'`,
    track: `'primary'`,
    employment_type: `'full_time'`,
    experience_band: `'junior_1_3'`,
    district_id: district,
    commission_type: `'split'`,
    leads_source: `'company_provided'`,
    description_ar: `'${(fields.description_ar ?? 'وصف الوظيفة').replaceAll("'", "''")}'`,
    status: `'${status}'`,
  };
  if (fields.requirements_ar) cols.requirements_ar = `'${fields.requirements_ar.replaceAll("'", "''")}'`;
  if (fields.created_at) cols.created_at = fields.created_at;
  const names = Object.keys(cols).join(', ');
  const values = Object.values(cols).join(', ');
  return (await one(`insert into jobs (${names}) values (${values}) returning id`)).id;
}

const count = async (sql) => Number((await one(sql)).n);

// ---------------------------------------------------------------------------
report.section('a candidate reports a listing, and the report is evidence');
{
  const job = await makeJob(rowad);

  const r = await as(candidate,
    `insert into reports (job_id, reporter_id, reason, detail, source, abusive, target_snapshot)
     values ('${job}', '${candidate}', 'scam', 'طلبوا مني رسوم تسجيل', 'system', true, '{"label_ar":"مزيف"}')
     returning target_type, target_id, source, abusive, severity, status,
               target_snapshot ->> 'label_ar' as label, target_snapshot ->> 'company_id' as company`);
  const row = r.rows[0];
  report.check('a signed-in candidate can report a listing', r.ok, r.error);
  report.check('the report records what it is about', row?.target_type === 'job' && row?.target_id === job);
  report.check('and what the listing said when it was reported, not what the client claimed',
    row?.label === 'مسؤول مبيعات عقارية' && row?.company === rowad, JSON.stringify(row));
  report.check('a reporter cannot file a "platform" report or pre-mark one as bad faith',
    row?.source === 'user' && row?.abusive === false, JSON.stringify(row));
  report.check('an allegation of fraud ranks as severity 3', row?.severity === 3, String(row?.severity));
  report.check('and it arrives new', row?.status === 'open');

  const quality = await as(candidate,
    `insert into reports (job_id, reporter_id, reason) values ('${job}', '${candidate}', 'spam') returning severity`);
  report.check('spam ranks as severity 1', quality.rows[0]?.severity === 1, JSON.stringify(quality.rows[0] ?? quality.error));

  const misleading = await as(candidate,
    `insert into reports (job_id, reporter_id, reason) values ('${job}', '${candidate}', 'misleading_pay') returning severity`);
  report.check('misleading pay ranks as severity 2', misleading.rows[0]?.severity === 2);
}

// ---------------------------------------------------------------------------
report.section('the same report twice');
{
  const job = await makeJob(rowad);
  const first = await persist(candidate3,
    `insert into reports (job_id, reporter_id, reason) values ('${job}', '${candidate3}', 'fake_listing') returning id`);
  report.check('the first report is filed', first.ok, first.error);

  const again = await as(candidate3,
    `insert into reports (job_id, reporter_id, reason) values ('${job}', '${candidate3}', 'scam')`);
  report.check('the same person cannot report the same listing twice, whatever the reason',
    !again.ok && /reports_one_per_reporter_per_job/.test(again.error ?? ''), again.error);

  const other = await as(candidate4,
    `insert into reports (job_id, reporter_id, reason) values ('${job}', '${candidate4}', 'scam') returning id`);
  report.check('a second person can — that is the signal the queue counts', other.ok, other.error);
}

// ---------------------------------------------------------------------------
report.section('report spam meets a limit, and only a pattern of abuse does');
{
  // Burst: three already in the last few minutes.
  const burstJobs = [await makeJob(capital), await makeJob(capital), await makeJob(capital), await makeJob(capital)];
  for (const job of burstJobs.slice(0, 3)) {
    await db.exec(`insert into reports (job_id, reporter_id, reason, created_at)
                   values ('${job}', '${candidate6}', 'spam', now() - interval '2 minutes')`);
  }
  const burst = await as(candidate6,
    `insert into reports (job_id, reporter_id, reason) values ('${burstJobs[3]}', '${candidate6}', 'spam')`);
  report.check('a fourth report inside ten minutes waits',
    !burst.ok && /report_burst_limit/.test(burst.error ?? ''), burst.error);

  // A new account: three today, spread out, from an account made this morning.
  await db.exec(`update profiles set created_at = now() - interval '3 hours' where id = '${candidate7}'`);
  const freshJobs = [await makeJob(rowad), await makeJob(hub, 'draft'), await makeJob(capital), await makeJob(rowad)];
  const freshTargets = [freshJobs[0], freshJobs[2]];
  for (const job of freshTargets) {
    await db.exec(`insert into reports (job_id, reporter_id, reason, created_at)
                   values ('${job}', '${candidate7}', 'spam', now() - interval '1 hour')`);
  }
  await db.exec(`insert into reports (company_id, reporter_id, reason, created_at)
                 values ('${hub}', '${candidate7}', 'suspicious_company', now() - interval '1 hour')`);
  const fresh = await as(candidate7,
    `insert into reports (job_id, reporter_id, reason) values ('${freshJobs[3]}', '${candidate7}', 'spam')`);
  report.check('an account under a day old gets three reports on its first day',
    !fresh.ok && /report_new_account_limit/.test(fresh.error ?? ''), fresh.error);

  await db.exec(`update profiles set created_at = now() - interval '40 days' where id = '${candidate7}'`);
  const seasoned = await as(candidate7,
    `insert into reports (job_id, reporter_id, reason) values ('${freshJobs[3]}', '${candidate7}', 'spam') returning id`);
  report.check('the same history from an established account is not a limit', seasoned.ok, seasoned.error);

  // One company's listings, over and over.
  const pileJobs = [await makeJob(hub, 'draft'), await makeJob(hub, 'draft'), await makeJob(hub, 'draft'), await makeJob(hub, 'draft')];
  for (const job of pileJobs.slice(0, 3)) {
    await db.exec(`insert into reports (job_id, reporter_id, reason, created_at)
                   values ('${job}', '${USERS.candidate2}', 'spam', now() - interval '2 days')`);
  }
  const pile = await as(USERS.candidate2,
    `insert into reports (job_id, reporter_id, reason) values ('${pileJobs[3]}', '${USERS.candidate2}', 'spam')`);
  report.check('a fourth report in a week about one company waits for the first three to be read',
    !pile.ok && /report_company_limit/.test(pile.error ?? ''), pile.error);

  const elsewhere = await as(USERS.candidate2,
    `insert into reports (job_id, reporter_id, reason) values ('${burstJobs[3]}', '${USERS.candidate2}', 'spam') returning id`);
  report.check('while a report about another company goes through', elsewhere.ok, elsewhere.error);

  const own = await as(employerVerified,
    `insert into reports (job_id, reporter_id, reason) values ('${freshJobs[0]}', '${employerVerified}', 'scam')`);
  report.check('nobody reports a listing of their own company',
    !own.ok && /report_own_target/.test(own.error ?? ''), own.error);

  const ownCompany = await as(employerUnverified,
    `insert into reports (company_id, reporter_id, reason) values ('${hub}', '${employerUnverified}', 'scam')`);
  report.check('or their own company, with the refusal named',
    !ownCompany.ok && /report_own_target/.test(ownCompany.error ?? ''), ownCompany.error);

  const ownProfile = await as(candidate,
    `insert into reports (agent_id, reporter_id, reason) values ('${gatedAgent}', '${candidate}', 'impersonation')`);
  report.check('or their own consultant profile',
    !ownProfile.ok && /report_own_target/.test(ownProfile.error ?? ''), ownProfile.error);

  const noTarget = await as(candidate,
    `insert into reports (reporter_id, reason) values ('${candidate}', 'other')`);
  report.check('a report must be about something', !noTarget.ok && /report_target_required/.test(noTarget.error ?? ''), noTarget.error);
}

// ---------------------------------------------------------------------------
report.section('a reporting ban is an admin decision, on the record');
{
  const job = await makeJob(rowad);

  const ban = await session(admin, async (q) => {
    await q(`select admin_set_reporting_restriction('${candidate4}', true, 'بلاغات كيدية متكررة')`);
    const audit = (await q(`select action, reason from admin_audit_log where target_id = '${candidate4}' order by id desc limit 1`))[0];
    await q(`set local role authenticated`);
    await q(`set local request.jwt.claim.sub = '${candidate4}'`);
    await q(`set local request.jwt.claims = '{"role":"authenticated","sub":"${candidate4}"}'`);
    const refusal = await q.probe(`insert into reports (job_id, reporter_id, reason) values ('${job}', '${candidate4}', 'spam')`);
    return { audit, refusal };
  });
  report.check('a banned account cannot file a report', /reporting_restricted/.test(ban.value?.refusal ?? ''),
    JSON.stringify(ban.value ?? ban.error));
  report.check('and the ban is recorded with its reason',
    ban.value?.audit?.action === 'user.reporting_restricted' && ban.value.audit.reason === 'بلاغات كيدية متكررة');

  const noReason = await as(admin, `select admin_set_reporting_restriction('${candidate4}', true, '')`);
  report.check('a ban needs a reason', !noReason.ok && /reason_required/.test(noReason.error ?? ''), noReason.error);

  const lifted = await session(admin, async (q) => {
    await q(`select admin_set_reporting_restriction('${candidate4}', true, 'سبب كاف للاختبار')`);
    await q(`select admin_set_reporting_restriction('${candidate4}', false, 'اتضح انها بلاغات صحيحة')`);
    return (await q(`select count(*)::int as n from reporting_restrictions where user_id = '${candidate4}'`))[0].n;
  });
  report.check('lifting it restores reporting', lifted.ok && lifted.value === 0, JSON.stringify(lifted));

  const self = await as(admin, `select admin_set_reporting_restriction('${admin}', true, 'سبب كاف')`);
  report.check('an admin cannot ban themselves (or another admin)', !self.ok, self.error);

  const seen = await as(candidate4, `select * from reporting_restrictions`);
  report.check('nobody but an admin reads the bans', seen.ok && seen.rows.length === 0, JSON.stringify(seen));

  const write = await as(candidate4,
    `insert into reporting_restrictions (user_id, reason) values ('${candidate3}', 'انتقام')`);
  report.check('or writes one', !write.ok, write.error);
}

// ---------------------------------------------------------------------------
report.section('a report outlives the listing it was about');
{
  const job = await makeJob(capital, 'active', { title_ar: 'إعلان سيُحذف', description_ar: 'نص الإعلان كما كان' });
  const filed = await persist(candidate3,
    `insert into reports (job_id, reporter_id, reason, detail) values ('${job}', '${candidate3}', 'scam', 'طلب فلوس') returning id`);
  const reportId = filed.rows[0]?.id;

  await db.exec(`delete from jobs where id = '${job}'`);

  const kept = await one(`select job_id, target_type, target_id, target_snapshot ->> 'label_ar' as label,
                                 target_snapshot ->> 'excerpt' as excerpt, status
                            from reports where id = '${reportId}'`);
  report.check('deleting the listing leaves the report behind', Boolean(kept), 'report gone');
  report.check('unlinked, but still saying what it was about',
    kept?.job_id === null && kept?.target_type === 'job' && kept?.target_id === job, JSON.stringify(kept));
  report.check('and what the advert said', kept?.label === 'إعلان سيُحذف' && kept?.excerpt === 'نص الإعلان كما كان');

  const cases = await as(admin, `select target_state, label_ar, reports from admin_report_cases('new', 'job', null, null, null, null, null, '${job}')`);
  report.check('the queue still shows it, marked deleted, under its old title',
    cases.ok && cases.rows[0]?.target_state === 'deleted' && cases.rows[0]?.label_ar === 'إعلان سيُحذف',
    JSON.stringify(cases.rows[0] ?? cases.error));

  const perTarget = await as(admin, `select admin_moderate_reports('job', '${job}', 'resolved')`);
  report.check('the per-target lever cannot find a deleted target', !perTarget.ok && /not_found/.test(perTarget.error ?? ''), perTarget.error);

  const byId = await session(admin, async (q) => {
    const [{ n }] = await q(`select admin_close_reports(array['${reportId}']::uuid[], 'resolved', 'حُذف الإعلان') as n`);
    const row = (await q(`select status, resolved_by from reports where id = '${reportId}'`))[0];
    return { n, row };
  });
  report.check('but the report can be closed by its id',
    byId.value?.n === 1 && byId.value.row.status === 'resolved' && byId.value.row.resolved_by === admin,
    JSON.stringify(byId.value ?? byId.error));

  const rewrite = await as(admin, `update reports set reason = 'spam', detail = 'لا شيء' where id = '${reportId}'`);
  report.check('what was reported cannot be rewritten, even by an admin',
    !rewrite.ok && /report_evidence_is_fixed/.test(rewrite.error ?? ''), rewrite.error);

  const move = await as(admin, `update reports set job_id = (select id from jobs limit 1) where id = '${reportId}'`);
  report.check('nor pointed at another listing', !move.ok, move.error);

  const summary = await as(admin, `select admin_summary() ->> 'reports_open' as n`);
  report.check('and the rail badge still counts it while it is open',
    summary.ok && Number(summary.rows[0].n) >= 1, JSON.stringify(summary.rows[0] ?? summary.error));
}

// ---------------------------------------------------------------------------
report.section('the queue: new and under review, ranked, filtered');
{
  const severe = await makeJob(capital, 'active', { title_ar: 'قضية احتيال' });
  const mild = await makeJob(capital, 'active', { title_ar: 'قضية تكرار' });
  await persist(candidate, `insert into reports (job_id, reporter_id, reason) values ('${severe}', '${candidate}', 'scam')`);
  await persist(publicAgent, `insert into reports (job_id, reporter_id, reason) values ('${severe}', '${publicAgent}', 'fake_listing')`);
  await persist(candidate, `insert into reports (job_id, reporter_id, reason) values ('${mild}', '${candidate}', 'spam')`);

  const ranked = await as(admin,
    `select target_id, max_severity, reporters, reasons from admin_report_cases('new', 'job', null, null, null, null, null, null, 100, 0)`);
  const ids = ranked.rows.map((r) => r.target_id);
  report.check('an admin reads the queue', ranked.ok, ranked.error);
  report.check('a fraud allegation from two people ranks above a spam report',
    ids.indexOf(severe) > -1 && ids.indexOf(severe) < ids.indexOf(mild), JSON.stringify(ranked.rows.slice(0, 5)));
  const severeCase = ranked.rows.find((r) => r.target_id === severe);
  report.check('and says who and what, counted: two people, the worst allegation',
    severeCase?.reporters === 2 && severeCase?.max_severity === 3 &&
      severeCase?.reasons.includes('scam') && severeCase?.reasons.includes('fake_listing'),
    JSON.stringify(severeCase));

  const repeat = await as(admin,
    `select target_id from admin_report_cases('new', null, null, null, null, null, 2, null, 100, 0)`);
  report.check('"repeat reports" keeps only what more than one person reported',
    repeat.rows.some((r) => r.target_id === severe) && !repeat.rows.some((r) => r.target_id === mild));

  const bySeverity = await as(admin,
    `select target_id from admin_report_cases('new', null, null, 3, null, null, null, null, 100, 0)`);
  report.check('severity filters', bySeverity.rows.some((r) => r.target_id === severe) &&
    !bySeverity.rows.some((r) => r.target_id === mild));

  const byReason = await as(admin,
    `select target_id from admin_report_cases('new', null, 'spam', null, null, null, null, null, 100, 0)`);
  report.check('reason filters', byReason.rows.some((r) => r.target_id === mild) &&
    !byReason.rows.some((r) => r.target_id === severe));

  const byDate = await as(admin,
    `select count(*)::int as n from admin_report_cases('new', null, null, null, now() + interval '1 day', null, null, null, 100, 0)`);
  report.check('date filters', byDate.ok && byDate.rows[0].n === 0, JSON.stringify(byDate.rows[0] ?? byDate.error));

  const byType = await as(admin,
    `select count(*)::int as n from admin_report_cases('new', 'agent', null, null, null, null, null, null, 100, 0) where target_type <> 'agent'`);
  report.check('type filters', byType.ok && byType.rows[0].n === 0);

  const moved = await session(admin, async (q) => {
    await q(`select admin_moderate_reports('job', '${mild}', 'investigating')`);
    const newer = await q(`select target_id from admin_report_cases('new', null, null, null, null, null, null, null, 100, 0)`);
    const review = await q(`select target_id from admin_report_cases('under_review', null, null, null, null, null, null, null, 100, 0)`);
    return { inNew: newer.some((r) => r.target_id === mild), inReview: review.some((r) => r.target_id === mild) };
  });
  report.check('a case being investigated moves from new to under review',
    moved.value && !moved.value.inNew && moved.value.inReview, JSON.stringify(moved.value ?? moved.error));

  const closed = await session(admin, async (q) => {
    await q(`select admin_moderate_reports('job', '${mild}', 'dismissed')`);
    return q(`select id, reason, reporter_name, reporter_filed from admin_report_rows(null, 'dismissed', null, null, null, null, null, 100, 0)`);
  });
  report.check('closed reports are listed with the reporter\'s record beside them',
    closed.ok && closed.value.some((r) => r.reason === 'spam' && r.reporter_filed >= 1), JSON.stringify(closed.value?.slice(0, 2) ?? closed.error));

  const bad = await as(admin, `select * from admin_report_cases('everything')`);
  report.check('an unknown view is refused rather than guessed', !bad.ok && /invalid_action/.test(bad.error ?? ''));
}

// ---------------------------------------------------------------------------
report.section('bad faith is recorded, and decides nothing by itself');
{
  const job = await makeJob(rowad);
  // candidate4 has filed nothing that persisted; candidate6 is at its burst
  // limit from the spam checks above, which is exactly what that limit is for.
  const filed = await persist(candidate4,
    `insert into reports (job_id, reporter_id, reason) values ('${job}', '${candidate4}', 'impersonation') returning id`);
  const id = filed.rows[0]?.id;

  const noReason = await as(admin, `select admin_close_reports(array['${id}']::uuid[], 'dismissed', null, true)`);
  report.check('calling a report bad faith needs a reason', !noReason.ok && /reason_required/.test(noReason.error ?? ''), noReason.error);

  const wrong = await as(admin, `select admin_close_reports(array['${id}']::uuid[], 'resolved', 'سبب', true)`);
  report.check('and is only ever a dismissal', !wrong.ok && /invalid_action/.test(wrong.error ?? ''), wrong.error);

  const marked = await session(admin, async (q) => {
    await q(`select admin_close_reports(array['${id}']::uuid[], 'dismissed', 'منافس يبلغ عن كل إعلانات الشركة', true)`);
    const row = (await q(`select status, abusive from reports where id = '${id}'`))[0];
    const context = (await q(`select reporter_abusive from admin_report_rows(array['${id}']::uuid[])`))[0];
    const bell = (await q(`select payload from notifications where user_id = '${candidate4}' and kind = 'report_reviewed' order by created_at desc limit 1`))[0];
    const restricted = (await q(`select count(*)::int as n from reporting_restrictions where user_id = '${candidate4}'`))[0].n;
    const audit = (await q(`select action from admin_audit_log order by id desc limit 1`))[0];
    return { row, context, bell, restricted, audit };
  });
  report.check('marked: dismissed, in bad faith',
    marked.value?.row.status === 'dismissed' && marked.value.row.abusive === true, JSON.stringify(marked.value ?? marked.error));
  report.check('the reporter\'s record now shows it to the next moderator', marked.value?.context?.reporter_abusive === 1);
  report.check('the reporter is told only that the report was reviewed',
    marked.value?.bell?.payload?.outcome === 'reviewed' && !JSON.stringify(marked.value.bell.payload).includes('abusive'),
    JSON.stringify(marked.value?.bell));
  report.check('and nothing restricts them automatically', marked.value?.restricted === 0);
  report.check('the decision is on the record', marked.value?.audit?.action === 'report.dismissed_abusive');
}

// ---------------------------------------------------------------------------
report.section('the reporter is told; the reported are never told who');
{
  const job = await makeJob(capital, 'active', { title_ar: 'إعلان مُبلغ عنه' });
  await persist(candidate3, `insert into reports (job_id, reporter_id, reason, detail) values ('${job}', '${candidate3}', 'scam', 'اسمي أحمد وطلبوا فلوس')`);

  const outcome = await session(admin, async (q) => {
    await q(`select admin_moderate_reports('job', '${job}', 'resolved', 'إعلان مخالف', true)`);
    const reporterBell = (await q(`select payload, href from notifications where user_id = '${candidate3}' and kind = 'report_reviewed' order by created_at desc limit 1`))[0];
    const ownerBells = await q(`select payload from notifications n join company_members m on m.user_id = n.user_id
                                  where m.company_id = '${capital}' and n.created_at >= now()`);
    const job_ = (await q(`select status from jobs where id = '${job}'`))[0];
    return { reporterBell, ownerBells, job: job_ };
  });
  report.check('taking the listing down closes the report and tells the reporter it led to action',
    outcome.value?.job.status === 'rejected' && outcome.value.reporterBell?.payload.outcome === 'actioned' &&
      outcome.value.reporterBell.payload.title_ar === 'إعلان مُبلغ عنه',
    JSON.stringify(outcome.value ?? outcome.error));
  const leaked = JSON.stringify(outcome.value?.ownerBells ?? []);
  report.check('the company is told its listing came down, and nothing about by whom',
    (outcome.value?.ownerBells.length ?? 0) > 0 && !leaked.includes(candidate3) && !leaked.includes('أحمد'), leaked);

  const peek = await as(employer3, `select * from reports where target_id = '${job}'`);
  report.check('the company cannot read the reports about its listing', peek.ok && peek.rows.length === 0, JSON.stringify(peek));

  const rows = await as(employer3, `select * from admin_report_rows(array(select id from reports where target_id = '${job}'))`);
  report.check('nor reach them through the admin reader', !rows.ok && /forbidden/.test(rows.error ?? ''), rows.error);
}

// ---------------------------------------------------------------------------
report.section('listing actions follow the lifecycle, and two moderators converge');
{
  const job = await makeJob(rowad, 'active', { title_ar: 'إعلان للإيقاف' });

  const flow = await session(admin, async (q) => {
    const steps = {};
    steps.unpublish = (await q(`select admin_moderate_job('${job}', 'unpublish', 'يطلب رسوم من المتقدمين') as s`))[0].s;
    let second = null;
    second = await q.probe(`select admin_moderate_job('${job}', 'unpublish', 'مرة ثانية')`);
    steps.second = second;
    steps.note = (await q(`select rejection_note from jobs where id = '${job}'`))[0].rejection_note;
    steps.bell = (await q(`select kind from notifications n join company_members m on m.user_id = n.user_id
                            where m.company_id = '${rowad}' and n.payload ->> 'job_id' = '${job}' order by n.created_at desc limit 1`))[0];
    steps.restore = (await q(`select admin_moderate_job('${job}', 'restore', 'راجعنا القرار') as s`))[0].s;
    steps.close = (await q(`select admin_moderate_job('${job}', 'close', 'بطلب الشركة') as s`))[0].s;
    let reopen = null;
    reopen = await q.probe(`select admin_moderate_job('${job}', 'restore')`);
    steps.reopen = reopen;
    steps.audit = (await q(`select array_agg(action order by id) as a from admin_audit_log where target_id = '${job}'`))[0].a;
    return steps;
  });
  const v = flow.value ?? {};
  report.check('unpublish takes a live listing off the board with the reason', v.unpublish === 'rejected' && v.note === 'يطلب رسوم من المتقدمين', JSON.stringify(v));
  report.check('a second moderator doing the same is told it has already moved', /invalid_transition/.test(v.second ?? ''), v.second);
  report.check('the company hears about the takedown', v.bell?.kind === 'job_rejected', JSON.stringify(v.bell));
  report.check('restore puts it back', v.restore === 'active');
  report.check('close ends it on the company\'s behalf', v.close === 'closed');
  report.check('and a closed listing cannot be restored by a moderator', /invalid_transition/.test(v.reopen ?? ''), v.reopen);
  report.check('every step is on the record, in order',
    JSON.stringify(v.audit) === JSON.stringify(['job.unpublish', 'job.restore', 'job.close']), JSON.stringify(v.audit));
}

// ---------------------------------------------------------------------------
report.section('a live listing\'s text cannot change unseen');
{
  const cases = [
    ['requirements', `requirements_ar = 'ادفع رسوم تسجيل 500 جنيه'`],
    ['commission note', `commission_note_ar = 'العمولة بعد دفع التأمين'`],
    ['English title', `title_en = 'Sales – pay to apply'`],
    ['English description', `description_en = 'Send the fee to our wallet'`],
    ['employment type', `employment_type = 'freelance_commission_only'`],
  ];
  for (const [label, set] of cases) {
    const job = await makeJob(rowad);
    const r = await as(employerVerified, `update jobs set ${set} where id = '${job}' returning status`);
    report.check(`changing the ${label} of a live listing sends it back to review`,
      r.ok && r.rows[0]?.status === 'pending_review', JSON.stringify(r.rows[0] ?? r.error));
  }

  const job = await makeJob(rowad);
  const byAdmin = await as(admin, `update jobs set requirements_ar = 'تصحيح إملائي' where id = '${job}' returning status`);
  report.check('an admin correcting the text does not send it back', byAdmin.ok && byAdmin.rows[0]?.status === 'active', JSON.stringify(byAdmin.rows[0] ?? byAdmin.error));
}

// ---------------------------------------------------------------------------
report.section('a restricted or suspended employer keeps what is live and adds nothing');
{
  const draft = await makeJob(capital, 'draft');
  const live = await makeJob(capital, 'active');

  const held = await session(admin, async (q) => {
    await q(`select set_account_approval('${employer3}', 'pending', 'قيد المراجعة')`);
    const bell = (await q(`select kind, href from notifications where user_id = '${employer3}' and kind = 'account_held'`))[0];
    const liveNow = (await q(`select status from jobs where id = '${live}'`))[0].status;

    await q(`set local role authenticated`);
    await q(`set local request.jwt.claim.sub = '${employer3}'`);
    await q(`set local request.jwt.claims = '{"role":"authenticated","sub":"${employer3}"}'`);
    let submit = null;
    submit = await q.probe(`update jobs set status = 'pending_review' where id = '${draft}'`);
    let edit = null;
    edit = await q.probe(`update jobs set title_ar = 'عنوان جديد' where id = '${live}'`);
    const draftEdit = await q(`update jobs set title_ar = 'مسودة معدلة' where id = '${draft}' returning status`);
    const close = await q(`update jobs set status = 'closed' where id = '${live}' returning status`);
    return { bell, liveNow, submit, edit, draftEdit: draftEdit[0]?.status, close: close[0]?.status };
  });
  const h = held.value ?? {};
  report.check('restricting (holding) an account tells its holder', h.bell?.kind === 'account_held' && h.bell.href === '/employer', JSON.stringify(h.bell));
  report.check('and leaves the live listings up', h.liveNow === 'active');
  report.check('a restricted employer cannot submit a listing for review', /account_not_in_good_standing/.test(h.submit ?? ''), h.submit ?? JSON.stringify(held));
  report.check('nor slip an edit past review on a live one', /account_not_in_good_standing/.test(h.edit ?? ''), h.edit);
  report.check('but can still work on a draft and close a listing', h.draftEdit === 'draft' && h.close === 'closed', JSON.stringify(h));

  const suspended = await session(admin, async (q) => {
    await q(`select set_account_approval('${employer3}', 'rejected', 'احتيال مؤكد')`);
    const liveNow = (await q(`select status, rejection_note from jobs where id = '${live}'`))[0];
    await q(`set local role authenticated`);
    await q(`set local request.jwt.claim.sub = '${employer3}'`);
    await q(`set local request.jwt.claims = '{"role":"authenticated","sub":"${employer3}"}'`);
    let reportRefusal = null;
    reportRefusal = await q.probe(`insert into reports (company_id, reporter_id, reason) values ('${rowad}', '${employer3}', 'scam')`);
    let submit = null;
    submit = await q.probe(`update jobs set status = 'pending_review' where id = '${draft}'`);
    return { liveNow, reportRefusal, submit };
  });
  const s = suspended.value ?? {};
  report.check('suspending a one-person company\'s owner takes its listings down',
    s.liveNow?.status === 'rejected', JSON.stringify(s.liveNow ?? suspended.error));
  report.check('a suspended employer cannot report anybody', Boolean(s.reportRefusal), s.reportRefusal);
  report.check('or submit anything for review', /account_not_in_good_standing/.test(s.submit ?? ''), s.submit);

  const FRESH = '99999999-9999-9999-9999-000000000001';
  await db.exec(`insert into auth.users (id, email) values ('${FRESH}', 'fresh-employer@example.test')`);
  await db.exec(`insert into profiles (id, role, full_name, whatsapp_phone) values ('${FRESH}', 'employer', 'موظف جديد', '+201234500001')`);
  const fresh = await count(`select count(*) as n from notifications where user_id = '${FRESH}' and kind = 'account_held'`);
  report.check('a new employer waiting for their first review is not told they were restricted', fresh === 0, String(fresh));
}

// ---------------------------------------------------------------------------
report.section('a company suspension: the company is told why, the internet is not');
{
  const suspension = await session(admin, async (q) => {
    const [{ n }] = await q(`select admin_set_company_suspension('${hub}', true, 'انتحال صفة مطور معروف') as n`);
    const company = (await q(`select suspended_at is not null as suspended, suspension_reason from companies where id = '${hub}'`))[0];
    const privateReason = (await q(`select suspension_reason from company_moderation where company_id = '${hub}'`))[0];
    const bell = (await q(`select kind, payload, href from notifications where user_id = '${employerUnverified}' and kind = 'company_suspended' order by created_at desc limit 1`))[0];
    return { n, company, privateReason, bell };
  });
  const v = suspension.value ?? {};
  report.check('the company is suspended', v.company?.suspended === true, JSON.stringify(v));
  report.check('its public row carries no reason', v.company?.suspension_reason === null);
  report.check('the reason is kept where only the company and admins read it', v.privateReason?.suspension_reason === 'انتحال صفة مطور معروف');
  report.check('and the company\'s members are told, with the reason',
    v.bell?.payload?.note === 'انتحال صفة مطور معروف' && v.bell.href === '/employer', JSON.stringify(v.bell));

  await db.exec(`insert into company_moderation (company_id, suspension_reason) values ('${hub}', 'سبب داخلي')`);
  const anon = await as(null, `select * from company_moderation`, 'anon');
  report.check('a visitor cannot read it', !anon.ok || anon.rows.length === 0, JSON.stringify(anon));
  const outsider = await as(employerVerified, `select * from company_moderation where company_id = '${hub}'`);
  report.check('nor another company', outsider.ok && outsider.rows.length === 0, JSON.stringify(outsider));
  const member = await as(employerUnverified, `select suspension_reason from company_moderation where company_id = '${hub}'`);
  report.check('the company itself can', member.ok && member.rows[0]?.suspension_reason === 'سبب داخلي', JSON.stringify(member));
  const forge = await as(employerUnverified, `update company_moderation set suspension_reason = null where company_id = '${hub}'`);
  report.check('and cannot edit it', !forge.ok || forge.rows.length === 0);
  const column = await as(admin, `update companies set suspension_reason = 'علني' where id = '${hub}'`);
  report.check('no path writes a reason onto the public row', !column.ok, column.error);
  await db.exec(`delete from company_moderation where company_id = '${hub}'`);

  const restored = await session(admin, async (q) => {
    await q(`select admin_set_company_suspension('${hub}', true, 'سبب كاف')`);
    await q(`select admin_set_company_suspension('${hub}', false, 'تم التحقق من الأوراق')`);
    return (await q(`select count(*)::int as n from notifications where user_id = '${employerUnverified}' and kind = 'company_restored'`))[0].n;
  });
  report.check('restoring tells them too', restored.value === 1, JSON.stringify(restored));

  const restricted = await session(admin, async (q) => {
    await q(`select admin_set_agent_restriction('${gatedAgent}', true, 'صورة شخص آخر')`);
    return (await q(`select kind, payload from notifications where user_id = '${candidate}' and kind = 'profile_restricted'`))[0];
  });
  report.check('a consultant whose profile is restricted is told, with the reason',
    restricted.value?.kind === 'profile_restricted' && restricted.value.payload.note === 'صورة شخص آخر', JSON.stringify(restricted));
}

// ---------------------------------------------------------------------------
report.section('text flags catch what a scam asks for, and not what a job offers');
{
  const flags = async (text, host = null) =>
    (await one(`select public.safety_text_flags($$${text}$$, ${host ? `'${host}'` : 'null'}) as f`)).f;
  const has = (list, flag) => list.some((f) => f.flag === flag);
  const weight = (list, flag) => list.find((f) => f.flag === flag)?.weight;

  const money = [
    'مطلوب مندوبين مبيعات، رسوم التسجيل 300 جنيه تدفع مقدما',
    'لازم دفع مبلغ تأمين مسترد قبل استلام الشغل',
    'ادفع الرسوم على فودافون كاش 01012345678',
    'التحويل على انستا باي',
    'Registration fee of 500 EGP is required before the interview',
    'A refundable deposit secures your place',
    'يدفع المتقدم مبلغ رمزي',
  ];
  for (const text of money) {
    const f = await flags(text);
    report.check(`money asked of the candidate: «${text.slice(0, 32)}…»`,
      has(f, 'asks_for_money') && weight(f, 'asks_for_money') === 'high', JSON.stringify(f));
  }

  const documents = [
    'ابعت صورة البطاقة والرقم القومي على الواتساب',
    'هيوصلك كود التفعيل ابعتهولنا',
    'Send a copy of your national ID and bank account number',
    'We need your OTP to verify you',
  ];
  for (const text of documents) {
    const f = await flags(text);
    report.check(`identity or bank details asked for: «${text.slice(0, 32)}…»`, has(f, 'asks_for_documents'), JSON.stringify(f));
  }

  const legitimate = [
    'تأمين اجتماعي وطبي، وعمولة على كل حجز وحدة',
    'تعيين فوري، مقدم ومتوسط الوحدات يبدأ من 10%',
    'عمولة 1% من قيمة البيع ومرتب ثابت 8000 جنيه',
    'التدريب على حساب الشركة',
  ];
  for (const text of legitimate) {
    const f = await flags(text);
    report.check(`an ordinary advert is not flagged: «${text.slice(0, 32)}…»`,
      !f.some((x) => x.weight === 'high'), JSON.stringify(f));
  }

  const links = await flags('قدم من هنا bit.ly/abc123 أو انضم t.me/jobs_group وحمّل الاستمارة forms.gle/xyz');
  report.check('a shortened link is flagged', has(links, 'shortened_link') && weight(links, 'shortened_link') === 'high', JSON.stringify(links));
  report.check('a Telegram link is flagged', has(links, 'telegram_link'));
  report.check('an off-site form is flagged', has(links, 'form_link'));

  const lookalike = await flags('https://xn--80ak6aa92e.com/apply and http://185.22.10.4/login');
  report.check('a look-alike domain or a bare address is flagged', has(lookalike, 'suspicious_link'), JSON.stringify(lookalike));

  const own = await flags('قدّم على www.alrowad.com/careers', 'alrowad.com');
  report.check('a link to the company\'s own site is not', own.length === 0, JSON.stringify(own));

  const low = await flags('للتواصل واتساب 010 1234 5678 أو hr@example.com أو wa.me/201012345678 أو example.org');
  report.check('a phone number, an email, WhatsApp or another site is noted, at low weight',
    ['phone_in_text', 'email_in_text', 'whatsapp_link', 'external_link'].every((flag) => weight(low, flag) === 'low'),
    JSON.stringify(low));

  const evidence = (await flags('مطلوب مندوبين مبيعات، رسوم التسجيل 300 جنيه تدفع مقدما')).find((f) => f.flag === 'asks_for_money');
  report.check('each flag carries the words that raised it', /رسوم التسجيل/.test(evidence?.evidence ?? ''), JSON.stringify(evidence));

  const probe = await as(employerVerified, `select public.safety_text_flags('رسوم تسجيل')`);
  report.check('an employer cannot run text through the patterns to learn them', !probe.ok, probe.error);
  const probeAnon = await as(null, `select public.safety_text_flags('رسوم تسجيل')`, 'anon');
  report.check('nor can a visitor', !probeAnon.ok, probeAnon.error);
}

// ---------------------------------------------------------------------------
report.section('employer signals are for review, and change nothing');
{
  // A company named like a developer, created by its employer through the API.
  const IMPOSTOR = '99999999-9999-9999-9999-000000000002';
  const IMPOSTOR_CO = '99999999-9999-9999-9999-00000000c002';
  await db.exec(`insert into auth.users (id, email) values ('${IMPOSTOR}', 'impostor@example.test')`);
  await db.exec(`insert into profiles (id, role, full_name, whatsapp_phone, approval_status, created_at)
                 values ('${IMPOSTOR}', 'employer', 'منتحل', '+201009876543', 'approved', now() - interval '1 day')`);
  const created = await persist(IMPOSTOR,
    `insert into companies (id, owner_id, name_ar, name_en, slug, about_ar)
     values ('${IMPOSTOR_CO}', '${IMPOSTOR}', 'بالم هيلز للتسويق', 'Palm Hills Sales', 'palm-hills-sales-1',
             'للتقديم ادفع رسوم فتح ملف 200 جنيه') returning id`);
  report.check('the company is created as usual — nothing is blocked', created.ok, created.error);

  const flag = await one(`select reason, source, reporter_id, status, detail from reports
                           where target_type = 'company' and target_id = '${IMPOSTOR_CO}'`);
  report.check('its own words raise a platform flag in the queue',
    flag?.source === 'system' && flag?.reporter_id === null && flag?.status === 'open', JSON.stringify(flag));
  report.check('named for the worst thing found: another company\'s name', flag?.reason === 'impersonation', JSON.stringify(flag));

  await persist(IMPOSTOR, `update companies set about_ar = 'للتقديم ادفع رسوم فتح ملف 250 جنيه' where id = '${IMPOSTOR_CO}'`);
  report.check('editing it again does not raise a second flag while the first is open',
    (await count(`select count(*) as n from reports where target_id = '${IMPOSTOR_CO}' and source = 'system'`)) === 1);

  const signals = await as(admin, `select signals from admin_company_signals(array['${IMPOSTOR_CO}']::uuid[])`);
  const list = signals.rows[0]?.signals?.signals ?? [];
  const kinds = list.map((s) => s.signal);
  report.check('an admin sees the company\'s text flagged', kinds.includes('company_text'), JSON.stringify(list));
  report.check('and that its WhatsApp number is another company\'s',
    kinds.includes('shared_phone') && list.find((s) => s.signal === 'shared_phone').companies.some((c) => c.id === hub),
    JSON.stringify(list));

  // Mass posting and the same advert over and over.
  for (let i = 0; i < 5; i += 1) {
    await makeJob(IMPOSTOR_CO, 'pending_review', { description_ar: 'نفس الإعلان بالحرف' });
  }
  const busy = (await one(`select public.company_review_signals('${IMPOSTOR_CO}') as s`)).s.signals.map((s) => s.signal);
  report.check('five listings in a day is noted', busy.includes('mass_posting'), JSON.stringify(busy));
  report.check('and the same advert five times', busy.includes('duplicate_listings'), JSON.stringify(busy));

  // Another company's advert, word for word.
  const long = 'نبحث عن مستشار مبيعات عقارية لديه خبرة لا تقل عن سنتين في البيع الأول لمشروعات التجمع الخامس والعاصمة الإدارية الجديدة، ضمن فريق عمل محترف، مع عمولات مجزية وتدريب مستمر وليدز من الشركة';
  await makeJob(rowad, 'active', { description_ar: long });
  await makeJob(IMPOSTOR_CO, 'pending_review', { description_ar: long });
  const copied = (await one(`select public.company_review_signals('${IMPOSTOR_CO}') as s`)).s.signals.find((s) => s.signal === 'copied_listings');
  report.check('an advert copied from another company is noted, naming the company',
    copied?.companies.some((c) => c.id === rowad), JSON.stringify(copied));

  // A number shared with a suspended account.
  await db.exec(`update profiles set approval_status = 'rejected' where id = '${employerUnverified}'`);
  const linked = (await one(`select public.company_review_signals('${IMPOSTOR_CO}') as s`)).s.signals.map((s) => s.signal);
  report.check('a number shared with a suspended account is noted', linked.includes('phone_of_suspended_account'), JSON.stringify(linked));
  await db.exec(`update profiles set approval_status = 'approved' where id = '${employerUnverified}'`);

  const standing = await one(`select suspended_at, verification_status from companies where id = '${IMPOSTOR_CO}'`);
  const listings = await count(`select count(*) as n from jobs where company_id = '${IMPOSTOR_CO}' and status = 'pending_review'`);
  report.check('none of it suspends, rejects or hides anything',
    standing.suspended_at === null && listings === 6, JSON.stringify({ standing, listings }));

  const jobs = await as(admin,
    `select job_id, flags, company_signals from admin_job_signals(array(select id from jobs where company_id = '${IMPOSTOR_CO}' limit 3))`);
  report.check('the review queue gets each listing\'s flags with its company\'s signals',
    jobs.ok && jobs.rows.length === 3 && jobs.rows.every((r) => Array.isArray(r.company_signals.signals)), jobs.error);

  const flaggedJob = await makeJob(capital, 'pending_review', { description_ar: 'ابعت صورة البطاقة على الواتساب قبل المقابلة' });
  const flagged = await as(admin, `select * from admin_flagged_pending_jobs(500) as id`);
  report.check('and a "flagged" view of the listings waiting for review',
    flagged.ok && flagged.rows.some((r) => Object.values(r)[0] === flaggedJob), JSON.stringify(flagged.rows.slice(0, 3)));

  const verifiedName = await one(`select public.company_name_resemblance(null, 'الرواد العقارية مصر', null) as r`);
  report.check('a name containing a verified company\'s full name is noted', verifiedName.r?.kind === 'company', JSON.stringify(verifiedName.r));
  const plain = await one(`select public.company_name_resemblance(null, 'المستقبل للتسويق العقاري', 'Future Realty') as r`);
  report.check('an ordinary name is not', plain.r === null, JSON.stringify(plain.r));
}

// ---------------------------------------------------------------------------
report.section('appeals: one message about one decision, and one answer');
{
  const job = await makeJob(rowad, 'active', { title_ar: 'إعلان للاعتراض' });
  await db.exec(`update jobs set status = 'rejected', rejection_note = 'إعلان مكرر' where id = '${job}'`);

  const short = await as(employerVerified, `select submit_appeal('job', '${job}', 'غلط')`);
  report.check('an appeal says why, in at least a sentence', !short.ok && /appeal_message_required/.test(short.error ?? ''), short.error);

  const stranger = await as(employerUnverified, `select submit_appeal('job', '${job}', 'هذا الإعلان ليس مكرراً على الإطلاق')`);
  report.check('only the company whose listing it is can appeal', !stranger.ok && /not_appealable/.test(stranger.error ?? ''), stranger.error);

  const live = await makeJob(rowad);
  const notDecided = await as(employerVerified, `select submit_appeal('job', '${live}', 'لماذا هذا الإعلان منشور؟')`);
  report.check('there has to be a decision to appeal', !notDecided.ok && /not_appealable/.test(notDecided.error ?? ''), notDecided.error);

  const before = await as(employerVerified, `select my_appeal_state('job', '${job}') as s`);
  report.check('the page is told an appeal is open to this company', before.rows[0]?.s?.appealable === true, JSON.stringify(before.rows[0] ?? before.error));
  const strangerState = await as(employerUnverified, `select my_appeal_state('job', '${job}') as s`);
  report.check('and not to anybody else', strangerState.rows[0]?.s?.appealable === false, JSON.stringify(strangerState.rows[0]));

  const filed = await persist(employerVerified,
    `select submit_appeal('job', '${job}', 'الإعلان مختلف عن السابق: المنطقة والمرتب مختلفين') as id`);
  const appealId = filed.rows[0]?.id;
  report.check('the company appeals the rejection', filed.ok && Boolean(appealId), filed.error);

  const snapshot = await one(`select decision_snapshot, status from moderation_appeals where id = '${appealId}'`);
  report.check('the appeal keeps the decision it is about', snapshot?.decision_snapshot?.note === 'إعلان مكرر' && snapshot.status === 'open');

  const during = await as(employerVerified, `select my_appeal_state('job', '${job}') as s`);
  report.check('while one waits, the page shows it instead of offering another',
    during.rows[0]?.s?.appealable === false && during.rows[0]?.s?.open?.id === appealId, JSON.stringify(during.rows[0]));

  const twice = await as(employerVerified, `select submit_appeal('job', '${job}', 'نرجو المراجعة مرة أخرى بسرعة')`);
  report.check('one open appeal per decision', !twice.ok && /appeal_open/.test(twice.error ?? ''), twice.error);

  const mine = await as(employerVerified, `select id from moderation_appeals where id = '${appealId}'`);
  const theirs = await as(employerUnverified, `select id from moderation_appeals where id = '${appealId}'`);
  report.check('the company can see its appeal', mine.ok && mine.rows.length === 1);
  report.check('another company cannot', theirs.ok && theirs.rows.length === 0);

  const forge = await as(employerVerified, `update moderation_appeals set status = 'overturned' where id = '${appealId}' returning id`);
  report.check('nobody can answer their own appeal', !forge.ok || forge.rows.length === 0, JSON.stringify(forge));
  const insert = await as(employerVerified,
    `insert into moderation_appeals (subject_type, subject_id, appellant_id, message) values ('job', '${job}', '${employerVerified}', 'أدخلها مباشرة بدون فحص')`);
  report.check('or file one around the checks', !insert.ok, insert.error);

  const upheldNoReason = await as(admin, `select admin_decide_appeal('${appealId}', false)`);
  report.check('upholding needs a reason — the company asked why', !upheldNoReason.ok && /reason_required/.test(upheldNoReason.error ?? ''), upheldNoReason.error);

  const decided = await session(admin, async (q) => {
    const [{ r }] = await q(`select admin_decide_appeal('${appealId}', true, 'راجعنا: الإعلان مختلف فعلاً') as r`);
    let second = null;
    second = await q.probe(`select admin_decide_appeal('${appealId}', false, 'رأي آخر')`);
    const jobNow = (await q(`select status from jobs where id = '${job}'`))[0].status;
    const bell = (await q(`select payload, href from notifications where user_id = '${employerVerified}' and kind = 'appeal_decided' order by created_at desc limit 1`))[0];
    const audit = (await q(`select array_agg(action order by id) as a from admin_audit_log where target_id = '${job}'`))[0].a;
    return { r, second, jobNow, bell, audit };
  });
  const d = decided.value ?? {};
  report.check('overturning restores the listing through the normal lever', d.r === 'overturned' && d.jobNow === 'active', JSON.stringify(d));
  report.check('a second moderator answering the same appeal is refused', /invalid_transition/.test(d.second ?? ''), d.second);
  report.check('the company is told the outcome, with the note',
    d.bell?.payload.outcome === 'overturned' && d.bell.payload.note === 'راجعنا: الإعلان مختلف فعلاً' && d.bell.href === '/employer/jobs',
    JSON.stringify(d.bell));
  report.check('both the reversal and the answer are on the record',
    JSON.stringify(d.audit) === JSON.stringify(['job.restore', 'job.appeal_overturned']), JSON.stringify(d.audit));

  // Upheld, then a second appeal too soon.
  await db.exec(`update moderation_appeals set status = 'upheld', decided_at = now() - interval '2 days', decision_note = 'مازال مكرراً' where id = '${appealId}'`);
  const soon = await as(employerVerified, `select submit_appeal('job', '${job}', 'نطلب مراجعة جديدة لنفس الإعلان')`);
  report.check('a week passes before the same decision is appealed again', !soon.ok && /appeal_too_soon|not_appealable/.test(soon.error ?? ''), soon.error);

  // A company's suspension, appealed and overturned.
  const company = await session(admin, async (q) => {
    await q(`select admin_set_company_suspension('${hub}', true, 'رقم مشترك مع حساب موقوف')`);
    await q(`set local role authenticated`);
    await q(`set local request.jwt.claim.sub = '${employerUnverified}'`);
    await q(`set local request.jwt.claims = '{"role":"authenticated","sub":"${employerUnverified}"}'`);
    let jobAppeal = null;
    const rejected = (await q(`select id from jobs where company_id = '${hub}' and status = 'rejected' limit 1`))[0];
    if (rejected) {
      jobAppeal = await q.probe(`select submit_appeal('job', '${rejected.id}', 'الإعلان سليم ونريد استرجاعه')`);
    }
    const [{ id }] = await q(`select submit_appeal('company', '${hub}', 'الرقم ده رقم مكتب الاستقبال المشترك في المبنى') as id`);
    await q(`reset role`);
    await q(`set local role authenticated`);
    await q(`set local request.jwt.claim.sub = '${admin}'`);
    await q(`set local request.jwt.claims = '{"role":"authenticated","sub":"${admin}"}'`);
    await q(`select admin_decide_appeal('${id}', true, null)`);
    const now_ = (await q(`select suspended_at from companies where id = '${hub}'`))[0];
    return { jobAppeal, suspended: now_.suspended_at !== null, hadRejected: Boolean(rejected) };
  });
  report.check('a listing of a suspended company is appealed through the company',
    !company.value?.hadRejected || /company_suspended/.test(company.value?.jobAppeal ?? ''), JSON.stringify(company));
  report.check('and overturning the company\'s appeal lifts the suspension', company.ok && company.value.suspended === false, JSON.stringify(company));

  // An account suspension, appealed by its holder.
  const account = await session(admin, async (q) => {
    await q(`select set_account_approval('${candidate6}', 'rejected', 'بلاغات كثيرة')`);
    await q(`set local request.jwt.claim.sub = '${candidate6}'`);
    await q(`set local request.jwt.claims = '{"role":"authenticated","sub":"${candidate6}"}'`);
    await q(`set local role authenticated`);
    const [{ id }] = await q(`select submit_appeal('account', '${candidate6}', 'لم أرسل أي بلاغ كيدي، البلاغات كانت عن إعلانات نصب') as id`);
    let other = null;
    other = await q.probe(`select submit_appeal('account', '${candidate7}', 'نيابة عن صديقي الموقوف')`);
    await q(`reset role`);
    await q(`set local role authenticated`);
    await q(`set local request.jwt.claim.sub = '${admin}'`);
    await q(`set local request.jwt.claims = '{"role":"authenticated","sub":"${admin}"}'`);
    await q(`select admin_decide_appeal('${id}', true, 'رفعنا الإيقاف')`);
    return { other, status: (await q(`select approval_status from profiles where id = '${candidate6}'`))[0].approval_status };
  });
  report.check('a suspended account can appeal its own suspension', account.ok, account.error);
  report.check('and only its own', /not_appealable/.test(account.value?.other ?? ''), account.value?.other);
  report.check('overturning restores the account', account.value?.status === 'approved', JSON.stringify(account.value));

  const newcomer = await session(null, async (q) => {
    const id = '99999999-9999-9999-9999-000000000003';
    await q(`insert into auth.users (id, email) values ('${id}', 'newcomer@example.test')`);
    await q(`insert into profiles (id, role, full_name, whatsapp_phone) values ('${id}', 'employer', 'جديد', '+201234500003')`);
    await q(`set local role authenticated`);
    await q(`set local request.jwt.claim.sub = '${id}'`);
    await q(`set local request.jwt.claims = '{"role":"authenticated","sub":"${id}"}'`);
    try { await q(`select submit_appeal('account', '${id}', 'نريد الموافقة على الحساب بسرعة')`); return 'allowed'; } catch (e) { return e.message; }
  }, 'postgres');
  report.check('waiting for a first review is not a decision to appeal', /not_appealable/.test(newcomer.value ?? ''), JSON.stringify(newcomer));
  const newcomerState = await session(null, async (q) => {
    const id = '99999999-9999-9999-9999-000000000004';
    await q(`insert into auth.users (id, email) values ('${id}', 'newcomer2@example.test')`);
    await q(`insert into profiles (id, role, full_name, whatsapp_phone) values ('${id}', 'employer', 'جديد', '+201234500004')`);
    await q(`set local role authenticated`);
    await q(`set local request.jwt.claim.sub = '${id}'`);
    await q(`set local request.jwt.claims = '{"role":"authenticated","sub":"${id}"}'`);
    return (await q(`select my_appeal_state('account', '${id}') as s`))[0].s;
  }, 'postgres');
  report.check('and the page does not offer one', newcomerState.value?.appealable === false, JSON.stringify(newcomerState));

  const held = await session(admin, async (q) => {
    await q(`select set_account_approval('${candidate7}', 'pending', 'مراجعة')`);
    await q(`set local role authenticated`);
    await q(`set local request.jwt.claim.sub = '${candidate7}'`);
    await q(`set local request.jwt.claims = '{"role":"authenticated","sub":"${candidate7}"}'`);
    const [{ id }] = await q(`select submit_appeal('account', '${candidate7}', 'حسابي اتعلق بدون سبب واضح') as id`);
    return id;
  });
  report.check('but a hold a moderator put on the account is', held.ok && Boolean(held.value), held.error);

  const summary = await session(admin, async (q) => {
    await q(`select set_account_approval('${candidate7}', 'pending', 'مراجعة')`);
    await q(`set local role authenticated`);
    await q(`set local request.jwt.claim.sub = '${candidate7}'`);
    await q(`set local request.jwt.claims = '{"role":"authenticated","sub":"${candidate7}"}'`);
    await q(`select submit_appeal('account', '${candidate7}', 'حسابي اتعلق بدون سبب واضح')`);
    await q(`set local request.jwt.claim.sub = '${admin}'`);
    await q(`set local request.jwt.claims = '{"role":"authenticated","sub":"${admin}"}'`);
    return (await q(`select (admin_summary() ->> 'appeals_open')::int as n`))[0].n;
  });
  report.check('open appeals are counted on the console rail', summary.ok && summary.value >= 1, JSON.stringify(summary));
}

// ---------------------------------------------------------------------------
report.section('nobody but an admin reaches a moderation lever or reader');
{
  const someReport = (await one(`select id from reports limit 1`)).id;
  const someAppeal = (await one(`select id from moderation_appeals limit 1`)).id;
  const levers = [
    `select admin_close_reports(array['${someReport}']::uuid[], 'dismissed')`,
    `select admin_set_reporting_restriction('${candidate3}', true, 'سبب كاف')`,
    `select * from admin_report_cases()`,
    `select * from admin_report_rows(null, 'open')`,
    `select * from admin_job_signals(array(select id from jobs limit 1))`,
    `select * from admin_company_signals(array['${rowad}']::uuid[])`,
    `select * from admin_flagged_pending_jobs()`,
    `select admin_decide_appeal('${someAppeal}', true, 'نعم')`,
    `select admin_summary()`,
  ];
  const internal = [
    `select moderation_notify('${candidate}', 'report_reviewed', '{}'::jsonb, null)`,
    `select raise_system_report('company', '${rowad}', 'scam', 'x')`,
    `select company_review_signals('${rowad}')`,
    `select company_safety_flags('${rowad}')`,
    `select job_safety_flags((select id from jobs limit 1))`,
    `select company_name_resemblance(null, 'x', 'y')`,
    `select appeal_decision_snapshot('${candidate}', 'account', '${candidate}')`,
  ];

  for (const [label, id] of [['a candidate', candidate], ['an employer', employerVerified]]) {
    const allowed = [];
    for (const sql of [...levers, ...internal]) {
      const r = await as(id, sql);
      if (r.ok) allowed.push(sql.slice(7, 45));
    }
    report.check(`${label} is refused by all ${levers.length + internal.length}`, allowed.length === 0, allowed.join(', '));
  }

  const anonAllowed = [];
  for (const sql of [...levers, ...internal,
    `select submit_appeal('job', '${rowad}', 'اعتراض من زائر مجهول')`,
    `select my_appeal_state('job', '${rowad}')`]) {
    const r = await as(null, sql, 'anon');
    if (r.ok) anonAllowed.push(sql.slice(7, 45));
  }
  report.check('a signed-out visitor cannot even call them', anonAllowed.length === 0, anonAllowed.join(', '));

  const adminFailed = [];
  for (const sql of levers) {
    const r = await as(admin, sql);
    const domain = /^(not_found|no_change|invalid_transition|reason_required)/;
    if (!r.ok && !domain.test(r.error ?? '')) adminFailed.push(`${sql.slice(7, 45)}: ${r.error}`);
  }
  report.check('while an admin reaches every lever', adminFailed.length === 0, adminFailed.join('; '));

  const internalForAdmin = [];
  for (const sql of internal) {
    const r = await as(admin, sql);
    if (r.ok) internalForAdmin.push(sql.slice(7, 45));
  }
  report.check('and the internals are not API at all, not even for an admin',
    internalForAdmin.length === 0, internalForAdmin.join(', '));
}

const ok = report.finish();
process.exit(ok ? 0 : 1);
