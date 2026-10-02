/**
 * Decided on what was seen (migration 346), against the real migrations.
 * Run with: pnpm test:decisions  (also part of pnpm test:db)
 *
 * One section per finding, each a scenario that ran to the end before 346 and
 * is refused, or comes out different, after it — with the case that must
 * still work beside it. Every scenario runs in one transaction that is rolled
 * back. (The email leases' own token per row is in jobs.test.mjs, beside the
 * rest of the outbox's lease tests.)
 */
import { createTestDb, reporter, FIXTURES } from './setup.mjs';

const report = reporter();
const db = await createTestDb();

const ROWAD = 'aaaaaaaa-0000-0000-0000-000000000001'; // employer1's, verified
const HUB = 'aaaaaaaa-0000-0000-0000-000000000002'; // employer2's, unverified
const { admin, employerVerified: E1, employerUnverified: E2, candidate } = FIXTURES;

const one = async (sql) => (await db.query(sql)).rows[0];

/**
 * Steps in one transaction, each as somebody — `as: null` is the database
 * itself — and all of it rolled back at the end. A refused step is undone to
 * its savepoint and the scenario carries on.
 */
async function scenario(steps) {
  const results = [];
  await db.exec('begin');
  try {
    for (const { as: userId, role = 'authenticated', sql } of steps) {
      if (userId === null) {
        await db.exec("reset role; set local request.jwt.claim.sub = ''; set local request.jwt.claims = '';");
      } else {
        await db.exec(`set local role ${role};`);
        await db.exec(`set local request.jwt.claim.sub = '${userId ?? ''}';`);
        await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role, ...(userId ? { sub: userId } : {}) })}';`);
      }
      await db.exec('savepoint step;');
      try {
        const rows = (await db.query(sql)).rows;
        await db.exec('release savepoint step;');
        results.push({ ok: true, rows });
      } catch (error) {
        await db.exec('rollback to savepoint step;');
        results.push({ ok: false, error: error.message, rows: [] });
      }
    }
  } finally {
    await db.exec('rollback;');
  }
  return results;
}

const refused = (result, pattern) => !result.ok && (!pattern || pattern.test(result.error ?? ''));
const show = (result) => JSON.stringify(result.ok ? result.rows : result.error);

// What Supabase grants the API roles on storage; the harness stubs the schema.
await db.exec('grant usage on schema storage to authenticated, anon; grant select, insert, update, delete on storage.objects to authenticated, anon;');

const systemReports = `select reason from reports where target_type = 'company' and target_id = '${ROWAD}' and source = 'system'`;

report.section('1. a verified company that renames itself after a developer goes to the queue');
{
  const [renamed, flagged] = await scenario([
    { as: E1, sql: `update companies set name_ar = 'مجموعة طلعت مصطفى', name_en = 'Talaat Moustafa Group' where id = '${ROWAD}' returning verification_status` },
    { as: null, sql: systemReports },
  ]);
  report.check('the verified company may rename itself', renamed.ok && renamed.rows[0]?.verification_status === 'verified', show(renamed));
  report.check(
    "but a name borrowed from a developer raises an impersonation report, as it would for an unverified one",
    flagged.rows.some((row) => row.reason === 'impersonation'),
    show(flagged),
  );

  const [, plain] = await scenario([
    { as: E1, sql: `update companies set name_ar = 'الرواد للتسويق العقاري', name_en = 'Al Rowad Marketing' where id = '${ROWAD}'` },
    { as: null, sql: systemReports },
  ]);
  report.check('a rename that borrows nobody\'s name raises nothing', plain.ok && plain.rows.length === 0, show(plain));
}

const openAppeal = (subject) =>
  `(select id from moderation_appeals where subject_id = '${subject}' and status = 'open')`;
const appealMessage = 'أرجو مراجعة القرار مرة أخرى، البيانات صحيحة';

report.section('2. an appeal reverses the decision it was about, and only that');
{
  // Held, appealed, lifted by hand, suspended since for something else: the
  // old appeal about the hold must not lift the suspension.
  const results = await scenario([
    { as: admin, sql: `select set_account_approval('${E2}', 'pending', 'مراجعة الأوراق')` },
    { as: E2, sql: `select submit_appeal('account', '${E2}', '${appealMessage}')` },
    { as: admin, sql: `select set_account_approval('${E2}', 'approved', null)` },
    { as: admin, sql: `select set_account_approval('${E2}', 'rejected', 'رقم مرتبط بحساب محظور')` },
    { as: admin, sql: `select admin_decide_appeal(${openAppeal(E2)}, true, null) as outcome` },
    { as: null, sql: `select approval_status from profiles where id = '${E2}'` },
    { as: null, sql: `select metadata from admin_audit_log where action = 'user.appeal_overturned' and target_id = '${E2}'` },
  ]);
  const [held, appealed, , suspended, decided, state, audit] = results;
  report.check('the setup ran: held, appealed, lifted and suspended', held.ok && appealed.ok && suspended.ok, show(appealed));
  report.check('the old appeal can still be answered', decided.ok && decided.rows[0]?.outcome === 'overturned', show(decided));
  report.check('and the suspension made since stands', state.rows[0]?.approval_status === 'rejected', show(state));
  report.check(
    'the record says nothing was reversed, and why',
    audit.rows[0]?.metadata?.reversed === false && audit.rows[0]?.metadata?.decision === 'replaced',
    show(audit),
  );

  // A company suspended, appealed, lifted and suspended again later.
  const again = await scenario([
    { as: admin, sql: `select admin_set_company_suspension('${ROWAD}', true, 'بلاغات متكررة عن إعلانات وهمية')` },
    { as: E1, sql: `select submit_appeal('company', '${ROWAD}', '${appealMessage}')` },
    { as: admin, sql: `select admin_set_company_suspension('${ROWAD}', false, 'رُفع بعد المراجعة')` },
    { as: admin, sql: `select admin_set_company_suspension('${ROWAD}', true, 'سجل تجاري مزور')` },
    // One transaction has one now(): date the appeal's suspension a day back,
    // as it would be had the second come a day later.
    {
      as: null,
      sql: `update moderation_appeals
               set decision_snapshot = jsonb_set(decision_snapshot, '{suspended_at}', to_jsonb(now() - interval '1 day'))
             where subject_id = '${ROWAD}' and status = 'open'`,
    },
    { as: admin, sql: `select admin_decide_appeal(${openAppeal(ROWAD)}, true, null) as outcome` },
    { as: null, sql: `select suspended_at is not null as suspended from companies where id = '${ROWAD}'` },
  ]);
  const [, , , , , decidedAgain, stillSuspended] = again;
  report.check('an appeal about an earlier suspension is answered', decidedAgain.ok, show(decidedAgain));
  report.check('without lifting the suspension in force now', stillSuspended.rows[0]?.suspended === true, show(stillSuspended));

  // The decision still in force is reversed, as before.
  const same = await scenario([
    { as: admin, sql: `select admin_set_company_suspension('${ROWAD}', true, 'بلاغات متكررة عن إعلانات وهمية')` },
    { as: E1, sql: `select submit_appeal('company', '${ROWAD}', '${appealMessage}')` },
    { as: admin, sql: `select admin_decide_appeal(${openAppeal(ROWAD)}, true, null) as outcome` },
    { as: null, sql: `select suspended_at is null as lifted from companies where id = '${ROWAD}'` },
  ]);
  report.check('an appeal about the suspension in force lifts it', same[3].rows[0]?.lifted === true, show(same[2]));

  // A listing taken down, appealed, then edited: restoring it now would
  // publish text nobody reviewed.
  const job = await one(`select id from jobs where company_id = '${ROWAD}' and status = 'active' order by id limit 1`);
  const edited = await scenario([
    { as: admin, sql: `select admin_moderate_job('${job.id}', 'unpublish', 'رقم واتساب لجهة غير الشركة')` },
    { as: E1, sql: `select submit_appeal('job', '${job.id}', '${appealMessage}')` },
    { as: E1, sql: `update jobs set title_en = 'Sales consultant — call +20 100 000 0000' where id = '${job.id}' returning status` },
    { as: admin, sql: `select admin_decide_appeal(${openAppeal(job.id)}, true, null)` },
    { as: null, sql: `select status from jobs where id = '${job.id}'` },
    { as: admin, sql: `select admin_decide_appeal(${openAppeal(job.id)}, false, 'الإعلان اتعدل بعد الطلب، راجعه من صفحته') as outcome` },
  ]);
  const [takenDown, jobAppealed, editedRow, overturn, status, uphold] = edited;
  report.check('the setup ran: taken down, appealed, edited', takenDown.ok && jobAppealed.ok && editedRow.ok, show(editedRow));
  report.check('overturning an appeal about a listing edited since is refused', refused(overturn, /invalid_transition/), show(overturn));
  report.check('and the listing stays down', status.rows[0]?.status === 'rejected', show(status));
  report.check('the appeal can still be upheld, with a reason', uphold.ok && uphold.rows[0]?.outcome === 'upheld', show(uphold));
}

report.section('3. approve and verify act on what the page showed');
{
  const pending = await one(`select id, version from jobs where company_id = '${HUB}' and status = 'pending_review' limit 1`);
  const [edit, stale, current, bare] = await scenario([
    { as: E2, sql: `update jobs set title_ar = 'مستشار مبيعات — ادفع رسوم تسجيل' where id = '${pending.id}' returning version` },
    { as: admin, sql: `select admin_moderate_job('${pending.id}', 'reject', 'وصف غير مناسب', ${pending.version})` },
    { as: admin, sql: `select admin_moderate_job('${pending.id}', 'reject', 'وصف غير مناسب', (select version from jobs where id = '${pending.id}')) as status` },
    { as: null, sql: `select status from jobs where id = '${pending.id}'` },
  ]);
  report.check('the employer edits the listing while it waits', edit.ok && edit.rows[0]?.version > pending.version, show(edit));
  report.check('a decision on the version the moderator read is refused once it changed', refused(stale, /stale_version/), show(stale));
  report.check('and taken on the version as it is now', current.ok && current.rows[0]?.status === 'rejected', show(current));
  report.check('(which the listing shows)', bare.rows[0]?.status === 'rejected', show(bare));

  const [noVersion] = await scenario([
    { as: admin, sql: `select admin_moderate_job('${pending.id}', 'reject', 'وصف غير مناسب') as status` },
  ]);
  report.check('a call without a version works as it always did', noVersion.ok && noVersion.rows[0]?.status === 'rejected', show(noVersion));

  const company = await one(`select version from companies where id = '${HUB}'`);
  const [rename, staleReview, review] = await scenario([
    { as: E2, sql: `update companies set name_ar = 'بروبرتي هب للتسويق' where id = '${HUB}' returning version` },
    { as: admin, sql: `select admin_review_company('${HUB}', 'reject', 'الأوراق ناقصة', ${company.version})` },
    { as: admin, sql: `select admin_review_company('${HUB}', 'reject', 'الأوراق ناقصة', (select version from companies where id = '${HUB}')) as status` },
  ]);
  report.check('the company renames itself while it is reviewed', rename.ok, show(rename));
  report.check('a review of the company as it was is refused', refused(staleReview, /stale_version/), show(staleReview));
  report.check('and taken on the company as it is', review.ok && review.rows[0]?.status === 'rejected', show(review));
}

report.section('4. reports: kept, told truthfully, counted');
{
  const job = await one(`select id from jobs where company_id = '${ROWAD}' and status = 'active' order by id limit 1`);
  const file = `insert into reports (job_id, reporter_id, reason, detail) values ('${job.id}', '${candidate}', 'fake_listing', 'رقم تليفون غريب في الإعلان') returning id`;

  const [filed, deleted, edited, audited] = await scenario([
    { as: candidate, sql: file },
    { as: admin, sql: `delete from reports where job_id = '${job.id}' returning id` },
    { as: admin, sql: `update reports set status = 'investigating' where job_id = '${job.id}' returning id` },
    { as: null, sql: `select action, via from admin_audit_log where action = 'report.direct_update'` },
  ]);
  report.check('a candidate files a report', filed.ok, show(filed));
  report.check('an admin cannot delete it', (deleted.ok && deleted.rows.length === 0) || refused(deleted, /permission denied/), show(deleted));
  report.check('an admin who edits it through the API is on the record', edited.ok && audited.rows.some((row) => row.via === 'direct'), show(audited));

  const bell = `select payload ->> 'outcome' as outcome from notifications where user_id = '${candidate}' and kind = 'report_reviewed'`;
  const [, kept, keptBell] = await scenario([
    { as: candidate, sql: file },
    { as: admin, sql: `select admin_moderate_reports('job', '${job.id}', 'resolved', 'الإعلان سليم بعد المراجعة', false)` },
    { as: null, sql: bell },
  ]);
  report.check('"resolved, nothing taken down" is answered', kept.ok, show(kept));
  report.check('and tells the reporter it was reviewed, not acted on', keptBell.rows[0]?.outcome === 'reviewed', show(keptBell));

  const [, acted, actedBell] = await scenario([
    { as: candidate, sql: file },
    { as: admin, sql: `select admin_moderate_reports('job', '${job.id}', 'resolved', 'إعلان وهمي', true)` },
    { as: null, sql: bell },
  ]);
  report.check('a resolution that takes the listing down', acted.ok, show(acted));
  report.check('tells the reporter it was acted on', actedBell.rows[0]?.outcome === 'actioned', show(actedBell));

  const [, , counts] = await scenario([
    { as: candidate, sql: file },
    { as: null, sql: `delete from jobs where id = '${job.id}'` },
    {
      as: admin,
      sql: `select (admin_overview() -> 'reports' ->> 'open_targets')::int as overview,
                   (admin_summary() ->> 'reports_open')::int as rail`,
    },
  ]);
  report.check(
    "the overview counts a report about a listing since deleted, as the rail's badge does",
    counts.ok && counts.rows[0]?.overview === counts.rows[0]?.rail && counts.rows[0]?.overview >= 1,
    show(counts),
  );
}

report.section('5. the console finds a name however it is spelled');
{
  const [found] = await scenario([
    { as: admin, sql: `select full_name from admin_search_users('احمد محمود', null, null, 25, 0)` },
  ]);
  report.check('«احمد» finds «أحمد»', found.ok && found.rows.some((row) => row.full_name === 'أحمد محمود'), show(found));
}

report.section('6. an account deletion request: from the account, and closed on the record');
{
  const ask = (topic, email = null) =>
    `select submit_support_request(gen_random_uuid(), '${topic}', 'أرجو حذف الحساب وكل البيانات من فضلكم', null, ${email ? `'${email}'` : 'null'})`;
  const [signedOut, signedIn] = await scenario([
    { as: undefined, role: 'anon', sql: ask('account_deletion', 'someone@example.com') },
    { as: candidate, sql: ask('account_deletion') },
  ]);
  report.check('a deletion request filed signed out is refused', refused(signedOut, /sign_in_required/), show(signedOut));
  report.check('from the account, it is taken', signedIn.ok, show(signedIn));

  const request = (topic) => `(select id from support_requests where user_id = '${candidate}' and topic = '${topic}')`;
  const [, , wrongTopic, closed, record] = await scenario([
    { as: candidate, sql: ask('account_deletion') },
    { as: candidate, sql: ask('other') },
    { as: admin, sql: `select admin_close_deletion_request(${request('other')})` },
    { as: admin, sql: `select admin_close_deletion_request(${request('account_deletion')}) as status` },
    { as: null, sql: `select actor_id from admin_audit_log where action = 'user.deletion_request_closed' and target_id = '${candidate}'` },
  ]);
  report.check('the deletion lever does not close other requests', refused(wrongTopic, /invalid_action/), show(wrongTopic));
  report.check('it closes a deletion request', closed.ok && closed.rows[0]?.status === 'closed', show(closed));
  report.check('and records who closed it', record.rows[0]?.actor_id === admin, show(record));
}

report.section('7. files stay as they were checked');
{
  // A reviewed paper whose file the server's byte check removed: the path is
  // not the company's to fill again.
  const reviewed = `${ROWAD}/commercial-register-1.pdf`;
  const [, refill, fresh] = await scenario([
    {
      as: null,
      sql: `insert into company_documents (company_id, doc_type, storage_path, status, reviewed_by, reviewed_at)
            values ('${ROWAD}', 'commercial_register', '${reviewed}', 'verified', '${admin}', now())`,
    },
    { as: E1, sql: `insert into storage.objects (bucket_id, name) values ('company-documents', '${reviewed}') returning name` },
    { as: E1, sql: `insert into storage.objects (bucket_id, name) values ('company-documents', '${ROWAD}/tax-card-2.pdf') returning name` },
  ]);
  report.check('a file at the path of a reviewed paper is refused', !refill.ok, show(refill));
  report.check('a new paper at a new path is taken', fresh.ok && fresh.rows.length === 1, show(fresh));

  // A paper waiting for review cannot be rewritten after the server checked it.
  const waiting = `${ROWAD}/tax-card-3.pdf`;
  const [, , rewrite, takeBack] = await scenario([
    { as: null, sql: `insert into storage.objects (bucket_id, name) values ('company-documents', '${waiting}')` },
    { as: null, sql: `insert into company_documents (company_id, doc_type, storage_path) values ('${ROWAD}', 'tax_card', '${waiting}')` },
    { as: E1, sql: `update storage.objects set created_at = now() where bucket_id = 'company-documents' and name = '${waiting}' returning name` },
    { as: E1, sql: `delete from storage.objects where bucket_id = 'company-documents' and name = '${waiting}' returning name` },
  ]);
  report.check('a waiting paper cannot be rewritten in place', rewrite.ok && rewrite.rows.length === 0, show(rewrite));
  report.check('it can still be taken back', takeBack.rows.length === 1, show(takeBack));

  // The cap counts the papers the company can still take back.
  const many = (n, prefix, status) =>
    Array.from({ length: n }, (_, i) => `${ROWAD}/${prefix}-${i}.pdf`).map((path) => ({ path, status }));
  const reviewedPapers = many(20, 'reviewed', 'rejected');
  const [, , afterReviewed, , afterLoose] = await scenario([
    {
      as: null,
      sql: `insert into storage.objects (bucket_id, name) values ${reviewedPapers.map((p) => `('company-documents', '${p.path}')`).join(', ')}`,
    },
    {
      as: null,
      sql: `insert into company_documents (company_id, doc_type, storage_path, status, reviewed_by, reviewed_at, review_note)
            values ${reviewedPapers.map((p) => `('${ROWAD}', 'tax_card', '${p.path}', 'rejected', '${admin}', now(), 'غير واضح')`).join(', ')}`,
    },
    { as: E1, sql: `insert into storage.objects (bucket_id, name) values ('company-documents', '${ROWAD}/after-reviewed.pdf') returning name` },
    {
      as: null,
      sql: `insert into storage.objects (bucket_id, name) values ${many(20, 'loose', null).map((p) => `('company-documents', '${p.path}')`).join(', ')}`,
    },
    { as: E1, sql: `insert into storage.objects (bucket_id, name) values ('company-documents', '${ROWAD}/after-loose.pdf') returning name` },
  ]);
  report.check('twenty reviewed papers no longer stop the next one', afterReviewed.ok && afterReviewed.rows.length === 1, show(afterReviewed));
  report.check('twenty the company could take back still do', !afterLoose.ok, show(afterLoose));

  // CVs: added and removed, never rewritten; one in use stays.
  const sent = `${candidate}/sent.pdf`;
  const spare = `${candidate}/spare.pdf`;
  const application = await one(`select id from applications where candidate_id = '${candidate}' order by id limit 1`);
  const [, , rewriteCv, removeSent, removeSpare, add, read] = await scenario([
    { as: null, sql: `insert into storage.objects (bucket_id, name) values ('cvs', '${sent}'), ('cvs', '${spare}')` },
    { as: null, sql: `update applications set cv_path = '${sent}' where id = '${application.id}'` },
    { as: candidate, sql: `update storage.objects set created_at = now() where bucket_id = 'cvs' and name = '${sent}' returning name` },
    { as: candidate, sql: `delete from storage.objects where bucket_id = 'cvs' and name = '${sent}' returning name` },
    { as: candidate, sql: `delete from storage.objects where bucket_id = 'cvs' and name = '${spare}' returning name` },
    { as: candidate, sql: `insert into storage.objects (bucket_id, name) values ('cvs', '${candidate}/new.pdf') returning name` },
    { as: candidate, sql: `select name from storage.objects where bucket_id = 'cvs' and name = '${sent}'` },
  ]);
  report.check('a CV cannot be rewritten after it was checked', rewriteCv.ok && rewriteCv.rows.length === 0, show(rewriteCv));
  report.check('nor removed while an application points at it', removeSent.ok && removeSent.rows.length === 0, show(removeSent));
  report.check('a CV nothing points at can be removed', removeSpare.rows.length === 1, show(removeSpare));
  report.check('a new CV goes in', add.ok && add.rows.length === 1, show(add));
  report.check('and the owner still reads their own', read.rows.length === 1, show(read));

  // Photos and logos come from the server, which re-encodes them.
  const [photo, , ownPhoto, removePhoto, logo] = await scenario([
    { as: candidate, sql: `insert into storage.objects (bucket_id, name) values ('avatars', '${candidate}/raw.jpg') returning name` },
    { as: null, sql: `insert into storage.objects (bucket_id, name) values ('avatars', '${candidate}/server.webp')` },
    { as: candidate, sql: `select name from storage.objects where bucket_id = 'avatars'` },
    { as: candidate, sql: `delete from storage.objects where bucket_id = 'avatars' and name = '${candidate}/server.webp' returning name` },
    { as: E1, sql: `insert into storage.objects (bucket_id, name) values ('company-logos', '${ROWAD}/raw.png') returning name` },
  ]);
  report.check('a person cannot write a photo straight into the public bucket', !photo.ok, show(photo));
  report.check('they see the one the server wrote', ownPhoto.rows.length === 1, show(ownPhoto));
  report.check('and may remove it', removePhoto.rows.length === 1, show(removePhoto));
  report.check('nor can a company admin write a logo past the server', !logo.ok, show(logo));
}

await db.close();
process.exit(report.finish() ? 0 : 1);
