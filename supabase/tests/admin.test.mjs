/**
 * The operations console, exercised as each kind of user.
 *
 * Migrations 316–318 put every moderation lever behind one SECURITY DEFINER
 * function and every decision on an append-only record. This suite asks the
 * questions an attacker and a tired moderator would: can anybody but an admin
 * reach a lever, can a lever produce a state the product does not have, does
 * every decision leave a record, and can anybody rewrite that record.
 *
 * Run with: pnpm test:admin (also part of pnpm test:db)
 */
import { createTestDb, runner, reporter, FIXTURES, USERS } from './setup.mjs';

const report = reporter();
const db = await createTestDb();
const as = runner(db);

const { employerVerified, employerUnverified, employerPending, candidate, publicAgent, admin } = FIXTURES;

/**
 * Several statements as one user in one transaction, rolled back afterwards —
 * for the questions `as()` cannot answer, which are about what a call *did*.
 */
async function session(userId, fn) {
  await db.exec('begin');
  try {
    await db.exec('set local role authenticated;');
    await db.exec(`set local request.jwt.claim.sub = '${userId}';`);
    await db.exec(`set local request.jwt.claims = '{"role":"authenticated","sub":"${userId}"}';`);
    const q = async (sql) => (await db.query(sql)).rows;
    return { ok: true, value: await fn(q) };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    await db.exec('rollback');
  }
}

const one = async (sql) => (await db.query(sql)).rows[0];

const rowad = (await one(`select company_id as id from company_members where user_id = '${employerVerified}' limit 1`)).id;
const hub = (await one(`select company_id as id from company_members where user_id = '${employerUnverified}' limit 1`)).id;
const district = (await one('select id from districts order by id limit 1')).id;
const gatedAgent = (await one(`select id from agent_profiles where user_id = '${candidate}'`)).id;

// A listing of our own in each state the tests need, on the verified company
// so the unverified post cap stays out of the way.
async function makeJob(status, extra = '') {
  const slug = `admin-test-${status}-${Math.random().toString(36).slice(2, 8)}`;
  return (
    await one(`
      insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band,
                        district_id, commission_type, leads_source, description_ar, status ${extra ? ', ' + extra.split('=')[0] : ''})
      values ('${rowad}', 'وظيفة اختبار', '${slug}', 'primary', 'full_time', 'junior_1_3', ${district},
              'split', 'company_provided', 'وصف', '${status}' ${extra ? ', ' + extra.split('=')[1] : ''})
      returning id`)
  ).id;
}

const pendingJob = await makeJob('pending_review');
const liveJob = await makeJob('active');
const draftJob = await makeJob('draft');

// ---------------------------------------------------------------------------
report.section('nobody but an admin reaches a lever');
{
  const levers = [
    `select admin_moderate_job('${pendingJob}', 'approve')`,
    `select admin_set_job_featured('${liveJob}', true)`,
    `select admin_review_company('${hub}', 'verify')`,
    `select admin_set_company_suspension('${hub}', true, 'سبب كافٍ')`,
    `select admin_set_agent_restriction('${gatedAgent}', true, 'سبب كافٍ')`,
    `select admin_moderate_reports('job', '${liveJob}', 'dismissed')`,
    `select admin_add_note('user', '${candidate}', 'ملاحظة')`,
    `select * from admin_reveal_contact('${candidate}', 'تواصل دعم')`,
    `select * from admin_view_contacts(array['${candidate}']::uuid[])`,
    `select admin_set_test_flag('${candidate}', null, true, null)`,
    `select admin_user_facts('${candidate}')`,
    `select * from admin_search_users('a')`,
    `select * from admin_search('ahmed')`,
    `select admin_overview()`,
    `select * from admin_taxonomy_usage('district')`,
    `select admin_save_taxonomy('developer', null, 'مطور', 'Dev', 'test-dev')`,
    `select admin_delete_taxonomy('developer', 1)`,
  ];

  const who = [
    ['a candidate', candidate],
    ['a public consultant', publicAgent],
    ['a verified employer', employerVerified],
    ['an unverified employer', employerUnverified],
  ];

  for (const [label, id] of who) {
    const allowed = [];
    for (const sql of levers) {
      const r = await as(id, sql);
      if (r.ok) allowed.push(sql.slice(7, 40));
    }
    report.check(`${label} is refused by every one of ${levers.length} levers`,
      allowed.length === 0, allowed.join(', '));
  }

  const anonAllowed = [];
  for (const sql of levers) {
    const r = await as(null, sql, 'anon');
    if (r.ok) anonAllowed.push(sql.slice(7, 40));
  }
  report.check('and a signed-out visitor cannot even call them', anonAllowed.length === 0,
    anonAllowed.join(', '));

  /*
    The control. Every refusal above would also "pass" if the statement were
    simply broken, so the same list has to succeed for an admin — each one in
    its own rolled-back transaction, so they do not depend on one another.
  */
  const adminFailed = [];
  for (const sql of levers) {
    const r = await as(admin, sql);
    // A business refusal (nothing open to dismiss, a developer still in use)
    // proves the statement ran; only an authorisation or syntax error fails.
    const domain = /^(not_found|no_change|invalid_transition|taxonomy_in_use|post_cap)/;
    if (!r.ok && !domain.test(r.error ?? '')) adminFailed.push(`${sql.slice(7, 40)}: ${r.error}`);
  }
  report.check(`and an admin reaches every one of them`, adminFailed.length === 0,
    adminFailed.join('; '));

  // The refusal is the database's, not a page's.
  const r = await as(candidate, `select admin_moderate_job('${pendingJob}', 'approve')`);
  report.check('the refusal names itself', /forbidden/.test(r.error ?? ''), r.error);

  const internal = await as(admin,
    `select admin_audit('job.approve', 'job', 'x', null, null, '{}'::jsonb, 'console')`);
  report.check('the audit writer is not callable even by an admin', !internal.ok, internal.error);
}

// ---------------------------------------------------------------------------
report.section('the audit record is admin-only and append-only');
{
  await db.exec(`
    insert into admin_audit_log (actor_id, action, target_type, target_id)
    values ('${admin}', 'job.approve', 'job', 'seeded')`);

  const byCandidate = await as(candidate, 'select count(*)::int as n from admin_audit_log');
  report.check('a candidate reads nothing', byCandidate.ok && byCandidate.rows[0].n === 0,
    JSON.stringify(byCandidate.rows[0] ?? byCandidate.error));

  const byEmployer = await as(employerVerified, 'select count(*)::int as n from admin_audit_log');
  report.check('nor does an employer', byEmployer.ok && byEmployer.rows[0].n === 0);

  const byAdmin = await as(admin, 'select count(*)::int as n from admin_audit_log');
  report.check('an admin reads it', byAdmin.ok && byAdmin.rows[0].n >= 1);

  const forge = await as(admin,
    `insert into admin_audit_log (actor_id, action, target_type, target_id) values ('${candidate}', 'user.approved', 'user', 'x')`);
  report.check('an admin cannot write an entry by hand', !forge.ok, forge.ok ? 'insert allowed' : forge.error);

  const rewrite = await as(null, "update admin_audit_log set reason = 'edited'", 'service_role');
  report.check('not even the service role can edit one',
    !rewrite.ok && /append_only/.test(rewrite.error ?? ''), rewrite.error);

  const erase = await as(null, 'delete from admin_audit_log', 'service_role');
  report.check('or delete one', !erase.ok && /append_only/.test(erase.error ?? ''), erase.error);

  const truncate = await as(null, 'truncate admin_audit_log', 'service_role');
  report.check('or truncate the table', !truncate.ok, truncate.error);

  const notes = await as(candidate, 'select count(*)::int as n from moderation_notes');
  report.check('internal notes are invisible to a candidate', notes.ok && notes.rows[0].n === 0);

  const oversized = await as(null,
    `insert into admin_audit_log (action, target_type, target_id, metadata)
     values ('job.approve', 'job', 'x', jsonb_build_object('dump', repeat('x', 9000)))`, 'service_role');
  report.check('a row dump is too big to be metadata', !oversized.ok, oversized.error);
}

// ---------------------------------------------------------------------------
report.section('listing moderation follows the lifecycle, and records itself');
{
  const approve = await session(admin, async (q) => {
    const [{ status }] = await q(`select admin_moderate_job('${pendingJob}', 'approve') as status`);
    const audit = await q(`select action, actor_id, metadata from admin_audit_log where target_id = '${pendingJob}'`);
    return { status, audit };
  });
  report.check('approving a waiting listing publishes it', approve.value?.status === 'active', approve.error);
  report.check('and records who, what, and the transition',
    approve.value?.audit.length === 1 &&
      approve.value.audit[0].action === 'job.approve' &&
      approve.value.audit[0].actor_id === admin &&
      approve.value.audit[0].metadata.from === 'pending_review',
    JSON.stringify(approve.value?.audit));

  const twice = await session(admin, async (q) => {
    await q(`select admin_moderate_job('${pendingJob}', 'approve')`);
    await q(`select admin_moderate_job('${pendingJob}', 'approve')`);
  });
  report.check('approving twice is refused the second time (double submission)',
    !twice.ok && /invalid_transition/.test(twice.error ?? ''), twice.error);

  const draft = await as(admin, `select admin_moderate_job('${draftJob}', 'approve')`);
  report.check('a draft cannot be published over the employer\'s head',
    !draft.ok && /invalid_transition/.test(draft.error ?? ''), draft.error);

  const noReason = await as(admin, `select admin_moderate_job('${pendingJob}', 'reject', '  ')`);
  report.check('a rejection without a reason is refused',
    !noReason.ok && /reason_required/.test(noReason.error ?? ''), noReason.error);

  const changes = await session(admin, async (q) => {
    await q(`select admin_moderate_job('${pendingJob}', 'request_changes', 'اكتب الراتب')`);
    return (await q(`select j.status, m.rejection_note from jobs j left join job_moderation m on m.job_id = j.id where j.id = '${pendingJob}'`))[0];
  });
  report.check('requesting changes sends it back with the note',
    changes.value?.status === 'rejected' && changes.value.rejection_note === 'اكتب الراتب',
    JSON.stringify(changes.value ?? changes.error));

  const takedown = await session(admin, async (q) => {
    await q(`select admin_moderate_job('${liveJob}', 'unpublish', 'إعلان وهمي')`);
    const down = (await q(`select status from jobs where id = '${liveJob}'`))[0].status;
    await q(`select admin_moderate_job('${liveJob}', 'restore')`);
    const back = (await q(`select j.status, m.rejection_note from jobs j left join job_moderation m on m.job_id = j.id where j.id = '${liveJob}'`))[0];
    return { down, back };
  });
  report.check('a takedown comes off the board and a restore puts it back',
    takedown.value?.down === 'rejected' && takedown.value.back.status === 'active' &&
      takedown.value.back.rejection_note === null,
    JSON.stringify(takedown.value ?? takedown.error));

  const closeThenRestore = await session(admin, async (q) => {
    await q(`select admin_moderate_job('${liveJob}', 'close', 'بطلب من الشركة')`);
    await q(`select admin_moderate_job('${liveJob}', 'restore')`);
  });
  report.check('a closed listing is the employer\'s to repost, not the admin\'s to reopen',
    !closeThenRestore.ok && /invalid_transition/.test(closeThenRestore.error ?? ''),
    closeThenRestore.error);

  const bogus = await as(admin, `select admin_moderate_job('${liveJob}', 'publish_forever')`);
  report.check('an unknown action is refused', !bogus.ok && /invalid_action/.test(bogus.error ?? ''));

  const ghost = await as(admin,
    `select admin_moderate_job('00000000-0000-0000-0000-000000000000', 'approve')`);
  report.check('an id that matches nothing is not a success',
    !ghost.ok && /not_found/.test(ghost.error ?? ''), ghost.error);

  const featureDraft = await as(admin, `select admin_set_job_featured('${draftJob}', true)`);
  report.check('only a live listing can be featured',
    !featureDraft.ok && /invalid_transition/.test(featureDraft.error ?? ''), featureDraft.error);
}

// ---------------------------------------------------------------------------
report.section('a suspended company stays off the board by every path');
{
  const r = await session(admin, async (q) => {
    const [{ n }] = await q(`select admin_set_company_suspension('${rowad}', true, 'احتيال مؤكد') as n`);
    const live = (await q(`select count(*)::int as c from jobs where company_id = '${rowad}' and status in ('active','pending_review')`))[0].c;
    const audit = (await q(`select metadata from admin_audit_log where action = 'company.suspended' and target_id = '${rowad}'`))[0];
    return { n, live, audit };
  });
  report.check('suspending takes every live and waiting listing down',
    r.ok && r.value.n > 0 && r.value.live === 0, JSON.stringify(r.value ?? r.error));
  report.check('and records how many it took',
    r.value?.audit?.metadata.listings_taken_down === r.value?.n, JSON.stringify(r.value?.audit));

  await db.exec(`update companies set suspended_at = now() where id = '${rowad}'`);

  const resubmit = await as(employerVerified,
    `update jobs set status = 'pending_review' where id = '${draftJob}'`);
  report.check('the employer cannot submit while suspended',
    !resubmit.ok && /company_suspended/.test(resubmit.error ?? ''), resubmit.error);

  const slug = `suspended-insert-${Date.now()}`;
  const insert = await as(employerVerified, `
    insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band,
                      district_id, commission_type, leads_source, description_ar, status)
    values ('${rowad}', 'x', '${slug}', 'primary', 'full_time', 'junior_1_3', ${district},
            'split', 'company_provided', 'x', 'pending_review')`);
  report.check('nor post something new for review', !insert.ok, insert.error);

  const approve = await as(admin, `select admin_moderate_job('${pendingJob}', 'approve')`);
  report.check('and an admin cannot approve one either',
    !approve.ok && /company_suspended/.test(approve.error ?? ''), approve.error);

  const lift = await as(employerVerified,
    `update companies set suspended_at = null where id = '${rowad}'`);
  report.check('the company cannot lift its own suspension',
    !lift.ok && /suspension is an admin action/.test(lift.error ?? ''), lift.error);

  const noReason = await as(admin, `select admin_set_company_suspension('${rowad}', false, '')`);
  report.check('restoring needs a reason too', !noReason.ok && /reason_required/.test(noReason.error ?? ''));

  const restore = await as(admin, `select admin_set_company_suspension('${rowad}', false, 'تم التحقق')`);
  report.check('an admin restores it', restore.ok, restore.error);

  await db.exec(`update companies set suspended_at = null, suspension_reason = null where id = '${rowad}'`);
}

// ---------------------------------------------------------------------------
report.section('company verification has four decisions and no others');
{
  const verifyVerified = await as(admin, `select admin_review_company('${rowad}', 'verify')`);
  report.check('verifying a verified company is refused',
    !verifyVerified.ok && /invalid_transition/.test(verifyVerified.error ?? ''), verifyVerified.error);

  const revoke = await session(admin, async (q) => {
    await q(`select admin_review_company('${rowad}', 'revoke', 'السجل منتهي')`);
    return (await q(`select verification_status, verified_at from companies where id = '${rowad}'`))[0];
  });
  report.check('revoking returns a verified company to unverified',
    revoke.value?.verification_status === 'unverified' && revoke.value.verified_at === null,
    JSON.stringify(revoke.value ?? revoke.error));

  const changesNotPending = await as(admin, `select admin_review_company('${hub}', 'request_changes', 'صورة أوضح')`);
  report.check('changes can only be requested on papers that were submitted',
    !changesNotPending.ok && /invalid_transition/.test(changesNotPending.error ?? ''), changesNotPending.error);

  const flow = await session(admin, async (q) => {
    await q(`insert into company_documents (company_id, doc_type, storage_path) values ('${hub}', 'tax_card', '${hub}/tax.pdf')`);
    const before = (await q(`select verification_status from companies where id = '${hub}'`))[0].verification_status;
    await q(`select admin_review_company('${hub}', 'request_changes', 'صورة أوضح')`);
    const after = (await q(`select c.verification_status, d.status as doc, d.review_note
                              from companies c join company_documents d on d.company_id = c.id
                             where c.id = '${hub}'`))[0];
    return { before, after };
  });
  report.check('requesting changes sends the papers back with the note',
    flow.value?.before === 'pending' && flow.value.after.verification_status === 'unverified' &&
      flow.value.after.doc === 'rejected' && flow.value.after.review_note === 'صورة أوضح',
    JSON.stringify(flow.value ?? flow.error));

  const selfVerify = await as(employerUnverified,
    `update companies set verification_status = 'verified' where id = '${hub}'`);
  report.check('an employer still cannot verify themselves', !selfVerify.ok, selfVerify.error);
}

// ---------------------------------------------------------------------------
report.section('a restricted consultant stays hidden through their own saves');
{
  await db.exec(`
    begin;
    set local request.jwt.claim.sub = '${admin}';
    set local request.jwt.claims = '{"role":"authenticated","sub":"${admin}"}';
    select admin_set_agent_restriction('${gatedAgent}', true, 'انتحال شخصية');
    commit;`);

  const state = await one(`select visibility, restricted_at is not null as restricted from agent_profiles where id = '${gatedAgent}'`);
  report.check('restricting hides the profile', state.visibility === 'hidden' && state.restricted);

  const save = await session(candidate, async (q) => {
    await q(`update agent_profiles set visibility = 'public', headline_ar = 'عنوان جديد' where id = '${gatedAgent}'`);
    return (await q(`select visibility, headline_ar from agent_profiles where id = '${gatedAgent}'`))[0];
  });
  report.check('the owner\'s save goes through but visibility stays hidden',
    save.ok && save.value.visibility === 'hidden' && save.value.headline_ar === 'عنوان جديد',
    JSON.stringify(save.value ?? save.error));

  const lift = await as(candidate, `update agent_profiles set restricted_at = null where id = '${gatedAgent}'`);
  report.check('the owner cannot lift the restriction',
    !lift.ok && /restriction is an admin action/.test(lift.error ?? ''), lift.error);

  const directory = await as(employerVerified,
    `select count(*)::int as n from search_agents(p_limit => 60) where id = '${gatedAgent}'`);
  report.check('and the directory no longer lists them', directory.ok && directory.rows[0].n === 0,
    JSON.stringify(directory.rows[0] ?? directory.error));

  const audit = await one(`select count(*)::int as n from admin_audit_log where action = 'agent.restricted' and target_id = '${gatedAgent}'`);
  report.check('the restriction is on the record', audit.n === 1);

  await db.exec(`
    begin;
    set local request.jwt.claim.sub = '${admin}';
    set local request.jwt.claims = '{"role":"authenticated","sub":"${admin}"}';
    select admin_set_agent_restriction('${gatedAgent}', false, 'تم التحقق من الهوية');
    commit;
    update agent_profiles set visibility = 'verified_employers_only' where id = '${gatedAgent}';`);

  const after = await one(`select restricted_at from agent_profiles where id = '${gatedAgent}'`);
  report.check('lifting it clears the restriction', after.restricted_at === null);
}

// ---------------------------------------------------------------------------
report.section('reports reach companies and consultants, and cannot be forged');
{
  const onCompany = await as(candidate,
    `insert into reports (company_id, reporter_id, reason) values ('${hub}', '${candidate}', 'suspicious_company') returning status, resolved`);
  report.check('a candidate can report a company',
    onCompany.ok && onCompany.rows[0].status === 'open' && onCompany.rows[0].resolved === false, onCompany.error);

  const ownCompany = await as(employerUnverified,
    `insert into reports (company_id, reporter_id, reason) values ('${hub}', '${employerUnverified}', 'scam')`);
  report.check('nobody reports their own company', !ownCompany.ok, ownCompany.ok ? 'allowed' : ownCompany.error);

  const ownAgent = await as(candidate,
    `insert into reports (agent_id, reporter_id, reason) values ('${gatedAgent}', '${candidate}', 'impersonation')`);
  report.check('or their own consultant profile', !ownAgent.ok, ownAgent.ok ? 'allowed' : ownAgent.error);

  const preResolved = await as(candidate,
    `insert into reports (company_id, reporter_id, reason, status) values ('${hub}', '${candidate}', 'scam', 'dismissed')`);
  report.check('a reporter cannot file a report already closed', !preResolved.ok);

  const twoTargets = await as(candidate,
    `insert into reports (company_id, job_id, reporter_id, reason) values ('${hub}', '${liveJob}', '${candidate}', 'scam')`);
  report.check('a report is about exactly one thing', !twoTargets.ok);

  await db.exec(`update profiles set approval_status = 'rejected' where id = '${publicAgent}'`);
  const suspended = await as(publicAgent,
    `insert into reports (company_id, reporter_id, reason) values ('${hub}', '${publicAgent}', 'scam')`);
  report.check('a suspended account files no reports', !suspended.ok);
  await db.exec(`update profiles set approval_status = 'approved' where id = '${publicAgent}'`);

  // Two people report the same company; the admin handles them as one.
  await db.exec(`
    insert into reports (company_id, reporter_id, reason) values
      ('${hub}', '${candidate}', 'suspicious_company'),
      ('${hub}', '${USERS.candidate3}', 'scam');`);

  const handled = await session(admin, async (q) => {
    const [{ r: first }] = await q(`select admin_moderate_reports('company', '${hub}', 'investigating') as r`);
    const [{ r: second }] = await q(`select admin_moderate_reports('company', '${hub}', 'resolved', 'شركة وهمية', true) as r`);
    const investigating = first.reports;
    const resolved = second.took_action ? second.reports : -1;
    const company = (await q(`select suspended_at is not null as suspended from companies where id = '${hub}'`))[0];
    const rows = await q(`select status, resolved, resolved_by from reports where company_id = '${hub}'`);
    return { investigating, resolved, company, rows };
  });
  report.check('both reports move together, first to investigating',
    handled.value?.investigating === 2, JSON.stringify(handled.value ?? handled.error));
  report.check('then resolved with the takedown done in the same step',
    handled.value?.resolved === 2 && handled.value.company.suspended &&
      handled.value.rows.every((r) => r.status === 'resolved' && r.resolved && r.resolved_by === admin),
    JSON.stringify(handled.value?.rows));

  const late = await session(admin, async (q) => {
    // The reason lives in company_moderation since migration 327; the column
    // on companies is public, so it stays empty.
    await q(`update companies set suspended_at = now() where id = '${hub}'`);
    const [{ r }] = await q(`select admin_moderate_reports('company', '${hub}', 'resolved', 'متأخر', true) as r`);
    return r;
  });
  report.check('a takedown somebody already did is reported as not done by this call',
    late.ok && late.value.took_action === false && late.value.reports === 2, JSON.stringify(late.value ?? late.error));

  const again = await session(admin, async (q) => {
    await q(`select admin_moderate_reports('company', '${hub}', 'dismissed')`);
    await q(`select admin_moderate_reports('company', '${hub}', 'dismissed')`);
  });
  report.check('closing an already-closed case is not a success',
    !again.ok && /not_found/.test(again.error ?? ''), again.error);

  const legacy = await session(admin, async (q) => {
    await q(`update reports set resolved = true where company_id = '${hub}'`);
    return q(`select status from reports where company_id = '${hub}'`);
  });
  report.check('the old boolean write still lands as a status',
    legacy.ok && legacy.value.every((r) => r.status === 'resolved'), JSON.stringify(legacy.value ?? legacy.error));

  const reporterReads = await as(candidate,
    `select count(*)::int as n from moderation_notes`);
  report.check('the reporter never sees internal notes', reporterReads.ok && reporterReads.rows[0].n === 0);
}

// ---------------------------------------------------------------------------
report.section('contact details are revealed one at a time, with a reason, on record');
{
  const noReason = await as(admin, `select * from admin_reveal_contact('${candidate}', '')`);
  report.check('no reason, no number', !noReason.ok && /reason_required/.test(noReason.error ?? ''));

  const reveal = await session(admin, async (q) => {
    const [row] = await q(`select * from admin_reveal_contact('${candidate}', 'شكوى من شركة')`);
    const [audit] = await q(`select reason, action from admin_audit_log where target_id = '${candidate}' and action = 'user.contact_revealed'`);
    return { row, audit };
  });
  report.check('the details come back to an admin who says why',
    reveal.ok && /^\+/.test(reveal.value.row.whatsapp_phone ?? '') && reveal.value.row.email === 'candidate1@demo.test',
    JSON.stringify(reveal.value ?? reveal.error));
  report.check('and the looking-up is itself recorded, with the reason',
    reveal.value?.audit?.reason === 'شكوى من شركة', JSON.stringify(reveal.value?.audit));

  const doc = await session(admin, async (q) => {
    const [{ id }] = await q(`insert into company_documents (company_id, doc_type, storage_path)
                              values ('${hub}', 'commercial_register', '${hub}/cr.pdf') returning id`);
    const [{ path }] = await q(`select admin_open_document('${id}') as path`);
    const [{ n }] = await q(`select count(*)::int as n from admin_audit_log where action = 'company.document_viewed'`);
    return { path, n };
  });
  report.check('opening a verification document is recorded too',
    doc.ok && doc.value.path === `${hub}/cr.pdf` && doc.value.n === 1, JSON.stringify(doc.value ?? doc.error));

  const docByEmployer = await as(employerVerified,
    `select admin_open_document((select id from company_documents limit 1))`);
  report.check('and nobody else can ask for a document path that way', !docByEmployer.ok);

  const facts = await as(admin, `select admin_user_facts('${candidate}') as f`);
  const f = facts.rows[0]?.f ?? {};
  report.check('sign-in facts carry no credential and no address',
    facts.ok && 'email_confirmed' in f && !('email' in f) && !JSON.stringify(f).includes('password'),
    JSON.stringify(f));
}

// ---------------------------------------------------------------------------
report.section('opening an account shows the contact without a reason, once an hour');
{
  const refused = await as(candidate, `select * from admin_view_contacts(array['${candidate}']::uuid[])`);
  report.check('a candidate cannot read contact this way', !refused.ok);

  const view = await session(admin, async (q) => {
    const [row] = await q(`select * from admin_view_contacts(array['${candidate}']::uuid[])`);
    const [{ n }] = await q(
      `select count(*)::int as n from admin_audit_log where action = 'user.contact_viewed' and target_id = '${candidate}'`,
    );
    await q(`select * from admin_view_contacts(array['${candidate}']::uuid[])`);
    const [{ n: again }] = await q(
      `select count(*)::int as n from admin_audit_log where action = 'user.contact_viewed' and target_id = '${candidate}'`,
    );
    return { row, n, again };
  });
  report.check(
    'an admin sees the email and the phone',
    view.ok && view.value.row.email === 'candidate1@demo.test' && /^\+/.test(view.value.row.whatsapp_phone ?? ''),
    JSON.stringify(view.value ?? view.error),
  );
  report.check(
    'and the look is recorded once in the hour',
    view.ok && view.value.n === 1 && view.value.again === 1,
    JSON.stringify(view.value ?? view.error),
  );
}

// ---------------------------------------------------------------------------
report.section('account search pages on the server and never returns contact details');
{
  const page1 = await as(admin, `select * from admin_search_users(null, null, null, 3, 0)`);
  const page2 = await as(admin, `select * from admin_search_users(null, null, null, 3, 3)`);
  const total = Number(page1.rows[0]?.total_count ?? 0);
  report.check('a page is the size asked for, with the total beside it',
    page1.ok && page1.rows.length === 3 && total > 6, `${page1.rows.length} of ${total}`);
  report.check('and the next page does not repeat it',
    page2.ok && !page2.rows.some((r) => page1.rows.find((p) => p.id === r.id)));

  const columns = Object.keys(page1.rows[0] ?? {});
  report.check('no phone or email column exists in a result',
    !columns.some((c) => /phone|email/.test(c)), columns.join(','));

  const phone = (await one(`select whatsapp_phone from profiles where id = '${candidate}'`)).whatsapp_phone;
  const local = '0' + phone.replace(/^\+20/, '');
  const byPhone = await as(admin, `select id from admin_search_users('${local}')`);
  report.check('a number pasted the local way still finds its account',
    byPhone.ok && byPhone.rows.some((r) => r.id === candidate), JSON.stringify(byPhone.rows));

  const byEmail = await as(admin, `select id from admin_search_users('CANDIDATE1@demo.test')`);
  report.check('an exact email finds its account', byEmail.ok && byEmail.rows.length === 1 && byEmail.rows[0].id === candidate);

  const wildcard = await as(admin, `select count(*)::int as n from admin_search_users('%')`);
  report.check('a % typed into the box is a character, not a wildcard',
    wildcard.ok && wildcard.rows[0].n === 0, JSON.stringify(wildcard.rows[0] ?? wildcard.error));

  const byRole = await as(admin, `select distinct role from admin_search_users(null, 'employer', null, 100, 0)`);
  report.check('filtering by role filters', byRole.ok && byRole.rows.length === 1 && byRole.rows[0].role === 'employer');

  const everything = await as(admin, `select kind from admin_search('${pendingJob}')`);
  report.check('the global box finds a listing by its id',
    everything.ok && everything.rows.some((r) => r.kind === 'job'), JSON.stringify(everything.rows));
}

// ---------------------------------------------------------------------------
report.section('account decisions need reasons, refuse no-ops and are recorded');
{
  const noReason = await as(admin, `select set_account_approval('${publicAgent}', 'rejected', null)`);
  report.check('a suspension without a reason is refused',
    !noReason.ok && /reason_required/.test(noReason.error ?? ''), noReason.error);

  const noop = await as(admin, `select set_account_approval('${publicAgent}', 'approved', null)`);
  report.check('approving an approved account is refused rather than repeated',
    !noop.ok && /no_change/.test(noop.error ?? ''), noop.error);

  const cycle = await session(admin, async (q) => {
    await q(`select set_account_approval('${publicAgent}', 'rejected', 'طلبات مزعجة')`);
    await q(`select set_account_approval('${publicAgent}', 'approved', null)`);
    return q(`select action, reason from admin_audit_log where target_id = '${publicAgent}' order by id`);
  });
  report.check('suspend then restore leaves two records, in words',
    cycle.ok && cycle.value.map((r) => r.action).join() === 'user.suspended,user.restored' &&
      cycle.value[0].reason === 'طلبات مزعجة',
    JSON.stringify(cycle.value ?? cycle.error));

  const admins = await as(admin, `select set_account_approval('${admin}', 'rejected', 'x y z')`);
  report.check('an admin still cannot suspend themselves', !admins.ok);
}

// ---------------------------------------------------------------------------
report.section('an admin going round the console is still recorded');
{
  const direct = await session(admin, async (q) => {
    await q(`update jobs set is_featured = true where id = '${liveJob}'`);
    return q(`select action, via, metadata from admin_audit_log where target_id = '${liveJob}'`);
  });
  report.check('a direct write by an admin is logged as direct, with the columns',
    direct.ok && direct.value.length === 1 && direct.value[0].via === 'direct' &&
      direct.value[0].metadata.columns.includes('is_featured'),
    JSON.stringify(direct.value ?? direct.error));

  const console = await session(admin, async (q) => {
    await q(`select admin_set_job_featured('${liveJob}', true)`);
    return q(`select via from admin_audit_log where target_id = '${liveJob}'`);
  });
  report.check('and a console write is logged once, not twice',
    console.ok && console.value.length === 1 && console.value[0].via === 'console',
    JSON.stringify(console.value ?? console.error));

  const employerWrite = await session(employerVerified, async (q) => {
    await q(`update jobs set status = 'closed' where id = '${liveJob}'`);
    return q(`select count(*)::int as n from admin_audit_log where target_id = '${liveJob}'`);
  });
  report.check('an employer closing their own listing is not an admin action',
    employerWrite.ok && employerWrite.value[0].n === 0, JSON.stringify(employerWrite.value ?? employerWrite.error));
}

// ---------------------------------------------------------------------------
report.section('taxonomy changes cannot break what uses them');
{
  const usedDistrict = (await one('select district_id as id from jobs limit 1')).id;

  const slug = await as(admin, `update districts set slug = 'renamed' where id = ${usedDistrict}`);
  report.check('a slug is permanent, even for an admin',
    !slug.ok && /taxonomy_slug_is_permanent/.test(slug.error ?? ''), slug.error);

  const del = await as(admin, `select admin_delete_taxonomy('district', ${usedDistrict})`);
  report.check('a district in use cannot be deleted',
    !del.ok && /taxonomy_in_use/.test(del.error ?? ''), del.error);

  const direct = await as(admin, `delete from districts where id = ${usedDistrict}`);
  report.check('not even by going round the console', !direct.ok && /taxonomy_in_use/.test(direct.error ?? ''));

  const agentOnly = (await one(`select unnest(district_ids) as id from agent_profiles
                                 except select district_id from jobs
                                 except select district_id from companies where district_id is not null
                                 limit 1`))?.id;
  if (agentOnly) {
    const arrayUse = await as(admin, `select admin_delete_taxonomy('district', ${agentOnly})`);
    report.check('including a district only a consultant\'s profile names', !arrayUse.ok, arrayUse.error);
  }

  const cycle = await session(admin, async (q) => {
    const gov = (await q('select id from governorates limit 1'))[0].id;
    const [{ id }] = await q(`select admin_save_taxonomy('district', null, 'حي جديد', 'New District', 'new-district-test', ${gov}) as id`);
    await q(`select admin_save_taxonomy('district', ${id}, 'حي أحدث', 'Newer District')`);
    const renamed = (await q(`select name_ar, slug from districts where id = ${id}`))[0];
    await q(`select admin_delete_taxonomy('district', ${id})`);
    const gone = (await q(`select count(*)::int as n from districts where id = ${id}`))[0].n;
    const actions = (await q(`select action from admin_audit_log where target_type = 'taxonomy' order by id`)).map((r) => r.action);
    return { renamed, gone, actions };
  });
  report.check('an unused district is created, renamed and deleted, each on record',
    cycle.ok && cycle.value.renamed.name_ar === 'حي أحدث' && cycle.value.renamed.slug === 'new-district-test' &&
      cycle.value.gone === 0 && cycle.value.actions.join() === 'taxonomy.created,taxonomy.renamed,taxonomy.deleted',
    JSON.stringify(cycle.value ?? cycle.error));

  const badSlug = await as(admin, `select admin_save_taxonomy('developer', null, 'مطور', 'Dev', 'Bad Slug!')`);
  report.check('a slug that is not a URL segment is refused', !badSlug.ok && /invalid_slug/.test(badSlug.error ?? ''));
}

// ---------------------------------------------------------------------------
report.section('the overview answers for an admin with real counts');
{
  const r = await as(admin, 'select admin_overview() as o');
  const o = r.rows[0]?.o;
  const liveCount = (await one(`select count(*)::int as n from jobs where status = 'active' and expires_at > now()`)).n;
  report.check('it returns every section', r.ok && ['jobs', 'applications', 'companies', 'accounts', 'agents', 'reports', 'recent'].every((k) => k in o),
    r.error);
  report.check('and live listings agree with the date, not the label', o?.jobs.live === liveCount,
    `${o?.jobs.live} vs ${liveCount}`);
}

// ---------------------------------------------------------------------------
report.section('accounts managed from one place (migration 355)');
{
  const levers = [
    `select admin_set_role('${candidate}', 'admin', 'انضم لفريق الدعم')`,
    `select admin_set_sign_in_block('${candidate}', true, 'حساب مخترق')`,
    `select admin_end_sessions('${candidate}', 'حساب مخترق')`,
    `select admin_end_sessions_of('${candidate}')`,
    `select admin_user_activity('${candidate}')`,
    `select * from admin_search_users(null, null, null, 25, 0, true)`,
  ];
  for (const [label, id] of [['a candidate', candidate], ['a verified employer', employerVerified]]) {
    const allowed = [];
    for (const sql of levers) {
      const r = await as(id, sql);
      if (r.ok) allowed.push(sql.slice(7, 40));
    }
    report.check(`${label} is refused by every one of the account levers`, allowed.length === 0, allowed.join(', '));
  }
  const anonAllowed = [];
  for (const sql of levers) {
    const r = await as(null, sql, 'anon');
    if (r.ok) anonAllowed.push(sql.slice(7, 40));
  }
  report.check('and a signed-out visitor cannot call them', anonAllowed.length === 0, anonAllowed.join(', '));

  // The role.
  let r = await as(admin, `select admin_set_role('${admin}', 'candidate', 'سبب كافٍ')`);
  report.check('an admin cannot change their own role', !r.ok && /own role/.test(r.error ?? ''), r.error);
  r = await as(admin, `select admin_set_role('${candidate}', 'admin', '')`);
  report.check('making an admin needs a reason', !r.ok && /reason_required/.test(r.error ?? ''), r.error);
  r = await as(admin, `select admin_set_role('${candidate}', 'employer', 'سبب كافٍ')`);
  report.check('a candidate is not made an employer by an admin', !r.ok && /invalid_transition/.test(r.error ?? ''), r.error);
  r = await as(admin, `select admin_set_role('${candidate}', 'candidate', 'سبب كافٍ')`);
  report.check('the role an account already has is no change', !r.ok && /no_change/.test(r.error ?? ''), r.error);
  r = await as(admin, `select admin_set_role('${employerPending}', 'admin', 'سبب كافٍ')`);
  report.check(
    'an account still waiting is not made an admin (approve it first; a promotion lifts no hold)',
    !r.ok && /invalid_transition/.test(r.error ?? ''),
    r.error,
  );
  // The lever is the only way: a plain update under an admin's token walks
  // round its reason, its record and its rules, and is refused by the guard.
  r = await as(admin, `update profiles set role = 'admin' where id = '${candidate}'`);
  report.check('a role is not changed by a plain update, even by an admin', !r.ok && /admin_set_role/.test(r.error ?? ''), r.error);
  const direct = await session(admin, async (q) => {
    await q('reset role');
    // The owner's own connection — migrations, the seed, the service role —
    // is trusted as before: no claims, no admin's token.
    await q(`set local request.jwt.claims = ''`);
    await q(`set local request.jwt.claim.sub = ''`);
    const [row] = await q(`update profiles set role = 'admin' where id = '${candidate}' returning role`);
    return row.role;
  });
  report.check('while a connection with no token (the seed, a migration) still may', direct.ok && direct.value === 'admin', direct.error);
  r = await as(admin, `select admin_end_sessions_of('${candidate}')`);
  report.check("the helper behind the levers is not an admin's to call (no reason, no record)", !r.ok && /permission denied|forbidden/i.test(r.error ?? ''), r.error);

  const blockedFirst = await session(admin, async (q) => {
    await q(`select admin_set_sign_in_block('${candidate}', true, 'حساب مخترق')`);
    await q('savepoint promote');
    let refused = null;
    try {
      await q(`select admin_set_role('${candidate}', 'admin', 'ترقية')`);
    } catch (error) {
      refused = error.message;
    }
    await q('rollback to savepoint promote');
    return refused;
  });
  report.check('an account whose sign-in is blocked is not made an admin (nobody could let it back in)', /invalid_transition/.test(blockedFirst.value ?? ''), blockedFirst.value ?? blockedFirst.error);

  const role = await session(admin, async (q) => {
    await q(`select admin_set_role('${candidate}', 'admin', 'انضم لفريق الدعم')`);
    const [profile] = await q(`select role, approval_status from profiles where id = '${candidate}'`);
    const [promoted] = await q(
      `select reason, metadata from admin_audit_log where target_type = 'user' and target_id = '${candidate}' and action = 'user.promoted' order by id desc limit 1`,
    );
    await q(`select admin_set_role('${candidate}', 'candidate', 'انتهى عمله معانا')`);
    const [after] = await q(`select role from profiles where id = '${candidate}'`);
    const [demoted] = await q(
      `select metadata from admin_audit_log where target_type = 'user' and target_id = '${candidate}' and action = 'user.demoted' order by id desc limit 1`,
    );
    return { profile, promoted, after, demoted };
  });
  report.check(
    'making an admin sets the role, leaves the standing as it was (approved), and records why',
    role.ok && role.value.profile.role === 'admin' && role.value.profile.approval_status === 'approved'
      && role.value.promoted?.reason === 'انضم لفريق الدعم' && role.value.promoted?.metadata?.to === 'admin',
    role.ok ? JSON.stringify(role.value.profile) : role.error,
  );
  report.check(
    'and taking it away is recorded with where they came from',
    role.ok && role.value.after.role === 'candidate' && role.value.demoted?.metadata?.from === 'admin',
    role.ok ? JSON.stringify(role.value.demoted) : role.error,
  );

  // The door.
  r = await as(admin, `select admin_set_sign_in_block('${admin}', true, 'سبب كافٍ')`);
  report.check('an admin cannot block their own sign-in', !r.ok && /own sign-in/.test(r.error ?? ''), r.error);
  r = await as(admin, `select admin_set_sign_in_block('${candidate}', true, '')`);
  report.check('blocking sign-in needs a reason', !r.ok && /reason_required/.test(r.error ?? ''), r.error);

  const block = await session(admin, async (q) => {
    const [first] = await q(`select admin_set_sign_in_block('${candidate}', true, 'حساب مخترق') as n`);
    const [facts] = await q(`select admin_user_facts('${candidate}') as f`);
    const listed = await q(`select id, total_count from admin_search_users(null, null, null, 25, 0, true)`);
    // The row says so, the "not blocked" view leaves it out, and no view at all counts both.
    const [row] = await q(`select sign_in_blocked, last_sign_in_at from admin_search_users(null, null, null, 500, 0, null) where id = '${candidate}'`);
    const unblocked = await q(`select id, total_count from admin_search_users(null, null, null, 500, 0, false)`);
    const [everyone] = await q(`select total_count from admin_search_users(null, null, null, 1, 0, null)`);
    await q('savepoint twice');
    let twice = null;
    try {
      await q(`select admin_set_sign_in_block('${candidate}', true, 'تاني')`);
    } catch (error) {
      twice = error.message;
    }
    await q('rollback to savepoint twice');
    await q(`select admin_set_sign_in_block('${candidate}', false, 'اتأكدنا إنه هو')`);
    const [lifted] = await q(`select admin_user_facts('${candidate}') as f`);
    const unlisted = await q(`select id from admin_search_users(null, null, null, 25, 0, true)`);
    const trail = await q(
      `select action, metadata from admin_audit_log where target_type = 'user' and target_id = '${candidate}' and action like 'user.sign_in_%' order by id`,
    );
    return { first: first.n, facts: facts.f, listed, row, unblocked, everyone, twice, lifted: lifted.f, unlisted, trail };
  });
  report.check(
    'blocking sign-in bans the account at the auth server, lists it as blocked, and records it',
    block.ok && Boolean(block.value.facts.sign_in_blocked_until) && block.value.listed.some((row) => row.id === candidate)
      && block.value.trail[0]?.action === 'user.sign_in_blocked' && block.value.trail[0]?.metadata?.sessions_ended === 0,
    block.ok ? JSON.stringify({ facts: block.value.facts, trail: block.value.trail }) : block.error,
  );
  report.check(
    'the list row says it is blocked, and carries the last sign-in',
    block.ok && block.value.row?.sign_in_blocked === true && 'last_sign_in_at' in (block.value.row ?? {}),
    block.ok ? JSON.stringify(block.value.row) : block.error,
  );
  report.check(
    'the "not blocked" view leaves it out, and no view at all counts both',
    block.ok && !block.value.unblocked.some((row) => row.id === candidate)
      && Number(block.value.everyone.total_count) === Number(block.value.unblocked[0]?.total_count ?? 0) + Number(block.value.listed[0]?.total_count ?? 0),
    block.ok ? `all ${block.value.everyone.total_count} = ${block.value.unblocked[0]?.total_count} + ${block.value.listed[0]?.total_count}` : block.error,
  );
  report.check('blocking it twice is no change', /no_change/.test(block.value?.twice ?? ''), block.value?.twice);
  report.check(
    'and lifting the block lets the account sign in again',
    block.ok && !block.value.lifted.sign_in_blocked_until && !block.value.unlisted.some((row) => row.id === candidate)
      && block.value.trail[1]?.action === 'user.sign_in_unblocked',
    block.ok ? JSON.stringify(block.value.lifted) : block.error,
  );

  const adminDoor = await session(admin, async (q) => {
    await q(`select admin_set_role('${candidate}', 'admin', 'ترقية')`);
    await q('savepoint door');
    let refused = null;
    try {
      await q(`select admin_set_sign_in_block('${candidate}', true, 'سبب كافٍ')`);
    } catch (error) {
      refused = error.message;
    }
    await q('rollback to savepoint door');
    return refused;
  });
  report.check("an admin's sign-in is not blocked from here", /belongs to an admin/.test(adminDoor.value ?? ''), adminDoor.value ?? adminDoor.error);

  // The sessions.
  r = await as(admin, `select admin_end_sessions('${admin}', 'سبب كافٍ')`);
  report.check('an admin cannot end their own sessions', !r.ok && /own sessions/.test(r.error ?? ''), r.error);
  // Two devices signed in and an authenticator enrolled, on the stub's own
  // tables, and somebody else's one device, which must survive — seeded as
  // the database's owner inside the session's own transaction (rolled back
  // with it), then back to the admin's role for the levers.
  const seedDevices = async (q, n) => {
    await q('reset role');
    await q(`insert into auth.sessions (user_id) select '${candidate}' from generate_series(1, ${n})`);
    await q(
      `insert into auth.refresh_tokens (user_id, session_id) select user_id, id from auth.sessions s where s.user_id = '${candidate}' and not exists (select 1 from auth.refresh_tokens t where t.session_id = s.id)`,
    );
    await q('set local role authenticated');
  };
  const ended = await session(admin, async (q) => {
    await q('reset role');
    await q(`insert into auth.mfa_factors (user_id, status) values ('${candidate}', 'verified')`);
    await q(`insert into auth.sessions (user_id) values ('${publicAgent}')`);
    await q(`insert into auth.refresh_tokens (user_id, session_id) select '${publicAgent}', id from auth.sessions where user_id = '${publicAgent}'`);
    await q('set local role authenticated');
    await seedDevices(q, 2);
    const others = async () => (await q(`select count(*)::int as n from auth.sessions where user_id = '${publicAgent}'`))[0].n;
    const [before] = await q(`select admin_user_facts('${candidate}') as f`);
    const [n] = await q(`select admin_end_sessions('${candidate}', 'حساب مخترق') as n`);
    const [after] = await q(`select admin_user_facts('${candidate}') as f`);
    const [left] = await q(`select count(*)::int as n from auth.refresh_tokens where user_id = '${candidate}'`);
    const [audit] = await q(
      `select reason, metadata from admin_audit_log where target_type = 'user' and target_id = '${candidate}' and action = 'user.sessions_ended' order by id desc limit 1`,
    );
    const othersAfterEnd = await others();
    // The block ends them too, by the same helper.
    await seedDevices(q, 3);
    const [blocked] = await q(`select admin_set_sign_in_block('${candidate}', true, 'حساب مخترق') as n`);
    const [afterBlock] = await q(`select admin_user_facts('${candidate}') as f`);
    const [blockAudit] = await q(
      `select metadata from admin_audit_log where target_type = 'user' and target_id = '${candidate}' and action = 'user.sign_in_blocked' order by id desc limit 1`,
    );
    const othersAfterBlock = await others();
    return { before: before.f, n: n.n, after: after.f, left: left.n, audit, othersAfterEnd, blocked: blocked.n, afterBlock: afterBlock.f, blockAudit, othersAfterBlock };
  });
  report.check(
    'the facts count the authenticator and the signed-in devices',
    ended.ok && ended.value.before.verified_factors === 1 && ended.value.before.sessions === 2,
    ended.ok ? JSON.stringify(ended.value.before) : ended.error,
  );
  report.check(
    'ending sessions signs every device out, takes its refresh tokens with it, and records how many',
    ended.ok && ended.value.n === 2 && ended.value.after.sessions === 0 && ended.value.left === 0
      && ended.value.audit?.metadata?.sessions_ended === 2 && ended.value.audit?.reason === 'حساب مخترق',
    ended.ok ? JSON.stringify({ n: ended.value.n, after: ended.value.after, left: ended.value.left }) : ended.error,
  );
  report.check(
    'blocking sign-in ends every device too, and records how many',
    ended.ok && ended.value.blocked === 3 && ended.value.afterBlock.sessions === 0 && ended.value.blockAudit?.metadata?.sessions_ended === 3,
    ended.ok ? JSON.stringify({ blocked: ended.value.blocked, after: ended.value.afterBlock, audit: ended.value.blockAudit }) : ended.error,
  );
  report.check(
    "and neither lever touches anybody else's devices",
    ended.ok && ended.value.othersAfterEnd === 1 && ended.value.othersAfterBlock === 1,
    ended.ok ? `${ended.value.othersAfterEnd}, ${ended.value.othersAfterBlock}` : ended.error,
  );

  // What the account has done.
  r = await as(admin, `select admin_user_activity('${candidate}') as a`);
  const activity = r.rows[0]?.a;
  report.check(
    'the activity has every section',
    r.ok && ['applications', 'listings', 'reports_filed', 'appeals', 'saved_jobs', 'notes', 'decisions'].every((key) => key in (activity ?? {})),
    r.error ?? JSON.stringify(activity),
  );
  const applied = (await one(`select count(*)::int as n from applications where candidate_id = '${candidate}'`)).n;
  const saved = (await one(`select count(*)::int as n from saved_jobs where candidate_id = '${candidate}'`)).n;
  report.check(
    'and counts what the account did',
    activity?.applications?.total === applied && activity?.saved_jobs === saved,
    `${activity?.applications?.total} vs ${applied}, ${activity?.saved_jobs} vs ${saved}`,
  );
  const facts = await as(admin, `select admin_user_facts('${admin}') as f`);
  report.check(
    'an account with no authenticator and no device reads as exactly that, and not blocked',
    facts.ok && facts.rows[0].f.verified_factors === 0 && facts.rows[0].f.sessions === 0 && facts.rows[0].f.sign_in_blocked_until === null,
    facts.error ?? JSON.stringify(facts.rows[0]?.f),
  );
}

process.exit(report.finish() ? 0 : 1);
