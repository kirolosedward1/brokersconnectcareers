/**
 * Doors a review found open (migrations 344, 347 and 349), against the
 * real migrations. Run with: pnpm test:doors  (also part of pnpm test:db)
 *
 * One section per door, each a scenario that ran to the end before 344 and is
 * refused, or comes out different, after it — with the case that must still
 * work beside it. Every scenario runs in one transaction that is rolled back,
 * so no section sees another's suspensions, reports or edits.
 */
import { createTestDb, reporter, FIXTURES, USERS } from './setup.mjs';

const report = reporter();
const db = await createTestDb();

const ROWAD = 'aaaaaaaa-0000-0000-0000-000000000001'; // employer1's, verified
const HUB = 'aaaaaaaa-0000-0000-0000-000000000002'; // employer2's, unverified
const CAPITAL = 'aaaaaaaa-0000-0000-0000-000000000003';
const { admin, employerVerified: E1, employerUnverified: E2, candidate, publicAgent, hiddenAgent } = FIXTURES;

const one = async (sql) => (await db.query(sql)).rows[0];

/**
 * Steps in one transaction, each as somebody — `as: null` is the database
 * itself (the migrations' and the cron's identity) — and all of it rolled
 * back at the end. A refused step is undone to its savepoint and the scenario
 * carries on, so a refusal and what follows it can both be read.
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
        await db.exec(`set local request.jwt.claim.sub = '${userId}';`);
        await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role, sub: userId })}';`);
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

// What Supabase grants the API roles on storage; the harness stubs the schema.
await db.exec('grant usage on schema storage to authenticated, anon; grant select, insert, update, delete on storage.objects to authenticated, anon;');

report.section('1. a listing taken down for a suspension does not carry the private reason');
{
  const rowadApplied = await one(`
    select a.candidate_id, j.id as job from applications a join jobs j on j.id = a.job_id
     where j.company_id = '${ROWAD}' and j.status = 'active' order by a.id limit 1`);
  const [suspended, read, readNote, companyNote] = await scenario([
    { as: admin, sql: `select admin_set_company_suspension('${ROWAD}', true, 'سبب داخلي: بلاغ عن احتيال المالك')` },
    { as: rowadApplied.candidate_id, sql: `select status, rejection_note from jobs where id = '${rowadApplied.job}'` },
    { as: rowadApplied.candidate_id, sql: `select rejection_note from job_moderation where job_id = '${rowadApplied.job}'` },
    { as: E1, sql: `select rejection_note from job_moderation where job_id = '${rowadApplied.job}'` },
  ]);
  report.check('an admin suspends a company with an internal reason', suspended.ok, suspended.error);
  report.check(
    'a candidate who applied reads that the listing was taken down, and no note at all',
    read.rows[0]?.status === 'rejected' && read.rows[0]?.rejection_note === null && readNote.ok && readNote.rows.length === 0,
    JSON.stringify({ listing: read.rows[0] ?? read.error, note: readNote.rows }),
  );
  report.check(
    'its company reads that the company is suspended, not the internal reason',
    companyNote.rows[0]?.rejection_note === 'الشركة موقوفة',
    JSON.stringify(companyNote.rows[0] ?? companyNote.error),
  );

  const hubApplied = await one(`
    select a.candidate_id, j.id as job from applications a join jobs j on j.id = a.job_id
     where j.company_id = '${HUB}' and j.status = 'active' order by a.id limit 1`);
  const [approval, readHub, readHubNote, adminNote] = await scenario([
    { as: admin, sql: `select set_account_approval('${E2}', 'rejected', 'ملاحظة المراجع: رقم مرتبط بحساب محظور')` },
    { as: hubApplied.candidate_id, sql: `select status, rejection_note from jobs where id = '${hubApplied.job}'` },
    { as: hubApplied.candidate_id, sql: `select rejection_note from job_moderation where job_id = '${hubApplied.job}'` },
    { as: admin, sql: `select rejection_note from job_moderation where job_id = '${hubApplied.job}'` },
  ]);
  report.check('an admin suspends the last approved account of a company', approval.ok, approval.error);
  report.check(
    'a candidate who applied to its listing reads that it was taken down, and no note at all',
    readHub.rows[0]?.status === 'rejected' && readHub.rows[0]?.rejection_note === null && readHubNote.ok && readHubNote.rows.length === 0,
    JSON.stringify({ listing: readHub.rows[0] ?? readHub.error, note: readHubNote.rows }),
  );
  report.check(
    "and the listing says the account is suspended, not the reviewer's note",
    adminNote.rows[0]?.rejection_note === 'الحساب موقوف',
    JSON.stringify(adminNote.rows[0] ?? adminNote.error),
  );
}

report.section('2. a report holds what its reporter could see, about what they could see');
{
  // A gated card whose owner never applied to the reporter's company — one
  // who did is unlocked to it by their application, not by the directory.
  const gated = await one(`
    select a.id, a.slug, p.full_name, a.user_id from agent_profiles a join profiles p on p.id = a.user_id
     where a.visibility = 'verified_employers_only' and p.approval_status = 'approved' and p.role = 'candidate'
       and not exists (
         select 1 from applications ap join jobs j on j.id = ap.job_id
          where ap.candidate_id = a.user_id and j.company_id = '${HUB}')
     order by a.user_id limit 1`);
  const [locked, filed] = await scenario([
    { as: E2, sql: `select is_unlocked, full_name from get_agent_card('${gated.id}')` },
    {
      as: E2,
      sql: `insert into reports (agent_id, reporter_id, reason) values ('${gated.id}', '${E2}', 'other')
            returning target_snapshot as snapshot`,
    },
  ]);
  report.check(
    'an employer of an unverified company sees a gated card without its name',
    locked.rows[0]?.is_unlocked === false && locked.rows[0]?.full_name === null,
    JSON.stringify(locked.rows[0] ?? locked.error),
  );
  const snapshot = filed.rows[0]?.snapshot ?? {};
  report.check('may still report it', filed.ok, filed.error);
  report.check(
    'and what the report hands back — and the bell later quotes — is "a consultant profile", not the person',
    snapshot.label_ar === 'ملف استشاري' &&
      !JSON.stringify(snapshot).includes(gated.full_name) &&
      !('user_id' in snapshot) &&
      !('slug' in snapshot),
    JSON.stringify(snapshot),
  );

  const hidden = await one(`select id from agent_profiles where user_id = '${hiddenAgent}'`);
  const [hiddenReport] = await scenario([
    {
      as: E1,
      sql: `insert into reports (agent_id, reporter_id, reason) values ('${hidden.id}', '${E1}', 'other')
            returning target_snapshot as snapshot`,
    },
  ]);
  report.check(
    'a hidden card cannot be reported by somebody who cannot see it, nor its name read back',
    refused(hiddenReport, /row-level security/),
    JSON.stringify(hiddenReport.rows[0] ?? hiddenReport.error),
  );

  const open = await one(`
    select a.id, p.full_name from agent_profiles a join profiles p on p.id = a.user_id
     where a.user_id = '${publicAgent}'`);
  const [openReport] = await scenario([
    {
      as: E1,
      sql: `insert into reports (agent_id, reporter_id, reason) values ('${open.id}', '${E1}', 'other')
            returning target_snapshot ->> 'label_ar' as label`,
    },
  ]);
  report.check(
    'a card open to its reporter is reported under the name they saw',
    openReport.rows[0]?.label === open.full_name,
    JSON.stringify(openReport.rows[0] ?? openReport.error),
  );

  const listing = await one(`select id from jobs where company_id = '${CAPITAL}' and status = 'active' order by id limit 1`);
  const [, draftReport] = await scenario([
    { as: null, sql: `update jobs set status = 'draft' where id = '${listing.id}'` },
    {
      as: candidate,
      sql: `insert into reports (job_id, reporter_id, reason) values ('${listing.id}', '${candidate}', 'spam')
            returning target_snapshot ->> 'label_ar' as label`,
    },
  ]);
  report.check(
    "another company's draft cannot be reported, nor its title read back",
    refused(draftReport, /row-level security/),
    JSON.stringify(draftReport.rows[0] ?? draftReport.error),
  );
  const [liveReport] = await scenario([
    {
      as: candidate,
      sql: `insert into reports (job_id, reporter_id, reason) values ('${listing.id}', '${candidate}', 'spam') returning id`,
    },
  ]);
  report.check('a live listing still can be', liveReport.ok, liveReport.error);
}

report.section('3. a membership is one person in one company');
{
  const CO_ADMIN = 'cccccccc-0000-0000-0000-00000000000a';
  const RECRUITER = 'cccccccc-0000-0000-0000-00000000000b';
  const setup = (id, email, role) => [
    { as: null, sql: `insert into auth.users (id, email) values ('${id}', '${email}')` },
    {
      as: null,
      sql: `insert into profiles (id, role, full_name, whatsapp_phone, approval_status, approved_at)
            values ('${id}', 'employer', 'Colleague', '+201234567890', 'approved', now())`,
    },
    { as: null, sql: `insert into company_members (company_id, user_id, role) values ('${ROWAD}', '${id}', '${role}')` },
  ];
  const results = await scenario([
    ...setup(CO_ADMIN, 'coadmin@demo.test', 'admin'),
    ...setup(RECRUITER, 'recruiter@demo.test', 'recruiter'),
    {
      as: CO_ADMIN,
      sql: `update company_members set user_id = '${USERS.employer7}'
             where company_id = '${ROWAD}' and user_id = '${E1}' returning user_id`,
    },
    { as: CO_ADMIN, sql: `select count(*)::int as n from company_members where company_id = '${ROWAD}' and user_id = '${E1}'` },
    {
      as: CO_ADMIN,
      sql: `update company_members set role = 'admin'
             where company_id = '${ROWAD}' and user_id = '${RECRUITER}' returning role`,
    },
  ]);
  const [rewrite, ownerStill, promote] = results.slice(-3);
  report.check(
    "a co-admin cannot hand the owner's row to another account",
    refused(rewrite, /company_member_identity/),
    JSON.stringify(rewrite.rows[0] ?? rewrite.error),
  );
  report.check('the owner is still a member', ownerStill.rows[0]?.n === 1, JSON.stringify(ownerStill.rows[0]));
  report.check("and a member's role still changes", promote.rows[0]?.role === 'admin', promote.error);
}

report.section('4. a suspended company leaves the directory');
{
  const gated = await one(`
    select a.slug from agent_profiles a join profiles p on p.id = a.user_id
     where a.visibility = 'verified_employers_only' and p.approval_status = 'approved' order by a.slug limit 1`);
  const before = await scenario([
    { as: E1, sql: 'select can_browse_agent_directory() as browses, viewer_has_verified_company() as verified' },
  ]);
  report.check(
    "a verified company's member browses the directory, unlocked",
    before[0].rows[0]?.browses === true && before[0].rows[0]?.verified === true,
    JSON.stringify(before[0].rows[0] ?? before[0].error),
  );
  const [, helpers, listed, reveal] = await scenario([
    { as: admin, sql: `select admin_set_company_suspension('${ROWAD}', true, 'شركة وهمية')` },
    { as: E1, sql: 'select can_browse_agent_directory() as browses, viewer_has_verified_company() as verified' },
    { as: E1, sql: 'select count(*)::int as n from search_agents()' },
    { as: E1, sql: `select status, whatsapp_phone from reveal_agent_contact('${gated.slug}')` },
  ]);
  report.check(
    'once the company is suspended, its member browses nothing and unlocks nothing',
    helpers.rows[0]?.browses === false && helpers.rows[0]?.verified === false,
    JSON.stringify(helpers.rows[0] ?? helpers.error),
  );
  report.check('the directory lists no card to them', listed.rows[0]?.n === 0, JSON.stringify(listed.rows[0] ?? listed.error));
  report.check(
    "and no consultant's number is handed over",
    reveal.rows[0]?.status !== 'ok' && !reveal.rows[0]?.whatsapp_phone,
    JSON.stringify(reveal.rows[0] ?? reveal.error),
  );
}

report.section("5. a logo is a file in the company's own folder");
{
  const [tracker, foreign, own, cleared] = await scenario([
    { as: E1, sql: `update companies set logo_url = 'https://tracker.example/p.png?c=rowad' where id = '${ROWAD}' returning id` },
    {
      as: E1,
      sql: `update companies set logo_url = 'https://abc.supabase.co/storage/v1/object/public/company-logos/${CAPITAL}/logo.webp'
             where id = '${ROWAD}' returning id`,
    },
    {
      as: E1,
      sql: `update companies set logo_url = 'https://abc.supabase.co/storage/v1/object/public/company-logos/${ROWAD}/logo-0f8e.webp'
             where id = '${ROWAD}' returning id`,
    },
    { as: E1, sql: `update companies set logo_url = null where id = '${ROWAD}' returning id` },
  ]);
  report.check('a third-party address is refused', refused(tracker, /logo_url must be a file/), JSON.stringify(tracker.rows[0] ?? tracker.error));
  report.check("another company's logo file is refused", refused(foreign, /logo_url must be a file/), JSON.stringify(foreign.rows[0] ?? foreign.error));
  report.check('a file in its own folder is taken, as the upload writes it', own.ok && own.rows.length === 1, own.error);
  report.check('and the logo can be taken off', cleared.ok && cleared.rows.length === 1, cleared.error);
}

report.section("6. the directory's rows are approved consultants'");
{
  const agent = await one(`select id from agent_profiles where user_id = '${publicAgent}'`);
  // An approved employer the consultant never applied to: the company somebody
  // applied to reads their card through its own policy, which is not this one.
  const reader = (
    await one(`
      select p.id from profiles p
       where p.role = 'employer' and p.approval_status = 'approved'
         and not exists (
           select 1 from applications a join jobs j on j.id = a.job_id
             join company_members m on m.company_id = j.company_id
            where a.candidate_id = '${publicAgent}' and m.user_id = p.id)
       order by p.id limit 1`)
  ).id;
  const [visible] = await scenario([{ as: reader, sql: `select id from agent_profiles where id = '${agent.id}'` }]);
  report.check("an approved consultant's public card is a row the directory reads", visible.rows.length === 1, visible.error);
  const [, suspended] = await scenario([
    { as: admin, sql: `select set_account_approval('${publicAgent}', 'rejected', 'حساب مخالف')` },
    { as: reader, sql: `select id, cv_path from agent_profiles where id = '${agent.id}'` },
  ]);
  report.check('a suspended consultant\'s is not', suspended.ok && suspended.rows.length === 0, JSON.stringify(suspended.rows));
  const [, held] = await scenario([
    { as: admin, sql: `select set_account_approval('${publicAgent}', 'pending', 'مراجعة')` },
    { as: reader, sql: `select id from agent_profiles where id = '${agent.id}'` },
  ]);
  report.check("nor a held one's", held.ok && held.rows.length === 0, JSON.stringify(held.rows));
}

report.section('7. a reviewed verification paper stays as it was reviewed');
{
  const reviewedPath = `${ROWAD}/commercial-register.pdf`;
  const pendingPath = `${ROWAD}/tax-card.pdf`;
  const results = await scenario([
    {
      as: null,
      sql: `insert into storage.objects (bucket_id, name, owner) values
              ('company-documents', '${reviewedPath}', '${E1}'), ('company-documents', '${pendingPath}', '${E1}')`,
    },
    {
      as: null,
      sql: `insert into company_documents (company_id, doc_type, storage_path, status, reviewed_by, reviewed_at)
            values ('${ROWAD}', 'commercial_register', '${reviewedPath}', 'verified', '${admin}', now()),
                   ('${ROWAD}', 'tax_card', '${pendingPath}', 'pending', null, null)`,
    },
    { as: E1, sql: `select name from storage.objects where bucket_id = 'company-documents' and name = '${reviewedPath}'` },
    {
      as: E1,
      sql: `delete from storage.objects where bucket_id = 'company-documents' and name = '${reviewedPath}' returning name`,
    },
    {
      as: E1,
      sql: `update storage.objects set created_at = now() where bucket_id = 'company-documents' and name = '${reviewedPath}' returning name`,
    },
    {
      as: E1,
      sql: `delete from storage.objects where bucket_id = 'company-documents' and name = '${pendingPath}' returning name`,
    },
  ]);
  const [read, removed, replaced, pendingRemoved] = results.slice(-4);
  report.check('the company still reads its verified paper', read.rows.length === 1, read.error);
  report.check('but cannot delete the file the verification was decided on', removed.ok && removed.rows.length === 0, JSON.stringify(removed.rows));
  report.check('nor replace it', replaced.ok && replaced.rows.length === 0, JSON.stringify(replaced.rows));
  report.check('a paper nobody has reviewed yet can still be taken back', pendingRemoved.rows.length === 1, pendingRemoved.error);
}

report.section('8. the apply limit counts what was sent, not what is left');
{
  const jobs = (
    await db.query(`
      select id from jobs
       where status = 'active' and (expires_at is null or expires_at > now())
         and id not in (select job_id from applications where candidate_id = '${candidate}')
       order by id limit 8`)
  ).rows.map((row) => row.id);
  report.check(`eight open listings to apply to (${jobs.length})`, jobs.length === 8);
  const apply = (job) => ({
    as: candidate,
    sql: `insert into applications (job_id, candidate_id) values ('${job}', '${candidate}') returning id`,
  });
  const results = await scenario([
    // Whatever the seed filed in the last ten minutes, aged out, so the
    // window holds exactly what this scenario sends.
    {
      as: null,
      sql: `update applications set created_at = created_at - interval '11 minutes'
             where candidate_id = '${candidate}' and created_at > now() - interval '10 minutes'`,
    },
    {
      as: null,
      sql: `update rate_limit_hits set created_at = created_at - interval '11 minutes'
             where bucket = 'applications:${candidate}' and created_at > now() - interval '10 minutes'`,
    },
    ...jobs.map(apply),
    {
      as: candidate,
      sql: `delete from applications where candidate_id = '${candidate}' and status = 'new'
               and job_id in (${jobs.map((id) => `'${id}'`).join(', ')}) returning id`,
    },
    apply(jobs[0]),
  ]);
  const sent = results.slice(2, 10);
  const withdrawn = results[10];
  const ninth = results[11];
  report.check('eight applications go in', sent.every((result) => result.ok), sent.find((result) => !result.ok)?.error);
  report.check('and are withdrawn', withdrawn.rows.length === 8, withdrawn.error);
  report.check(
    'the ninth in ten minutes is refused, withdrawn or not',
    refused(ninth, /application_rate_limit/),
    JSON.stringify(ninth.rows[0] ?? ninth.error),
  );
}

report.section("9. the applicant's declared experience stays theirs");
{
  const application = await one(`
    select a.id, a.experience_band from applications a join jobs j on j.id = a.job_id
     where j.company_id = '${ROWAD}' and a.experience_band <> 'senior_5_plus' order by a.id limit 1`);
  const [rewrite, decision] = await scenario([
    {
      as: E1,
      sql: `update applications set experience_band = 'senior_5_plus'::experience_band
             where id = '${application.id}' returning experience_band`,
    },
    { as: E1, sql: `update applications set decision_note = 'شكراً' where id = '${application.id}' returning id` },
  ]);
  report.check(
    'an employer cannot rewrite it',
    refused(rewrite, /only the application status and decision note/),
    JSON.stringify(rewrite.rows[0] ?? rewrite.error),
  );
  report.check('and still writes the decision', decision.ok && decision.rows.length === 1, decision.error);
}

report.section("10. a slug is not another card's id");
{
  const victim = await one(`select id from agent_profiles where user_id = '${USERS.candidate4}'`);
  const mine = await one(`select id from agent_profiles where user_id = '${USERS.candidate3}'`);
  const [taken, ownId, plain] = await scenario([
    { as: USERS.candidate3, sql: `update agent_profiles set slug = '${victim.id}' where user_id = '${USERS.candidate3}' returning slug` },
    { as: USERS.candidate3, sql: `update agent_profiles set slug = '${mine.id}' where user_id = '${USERS.candidate3}' returning slug` },
    {
      as: USERS.candidate3,
      sql: `update agent_profiles set slug = 'consultant-12345678' where user_id = '${USERS.candidate3}' returning slug`,
    },
  ]);
  report.check("another card's id is refused as a slug", refused(taken, /agent_profiles_slug_not_an_id/), JSON.stringify(taken.rows[0] ?? taken.error));
  report.check("a card's own id is still its own", ownId.ok && ownId.rows.length === 1, ownId.error);
  report.check('and an ordinary slug is untouched', plain.ok && plain.rows.length === 1, plain.error);
}

report.section('11. when a row was made is not the owner\'s to set');
{
  const [company, card, edit] = await scenario([
    { as: E2, sql: `update companies set created_at = '2015-01-01' where id = '${HUB}' returning created_at` },
    { as: candidate, sql: `update agent_profiles set created_at = '2999-01-01' where user_id = '${candidate}' returning created_at` },
    { as: E2, sql: `update companies set about_ar = 'شركة تسويق عقاري' where id = '${HUB}' returning id` },
  ]);
  report.check('a company cannot backdate itself', refused(company, /created_at is not owner-writable/), JSON.stringify(company.rows[0] ?? company.error));
  report.check('nor a consultant future-date a card', refused(card, /created_at is not owner-writable/), JSON.stringify(card.rows[0] ?? card.error));
  report.check('and the company page still saves', edit.ok && edit.rows.length === 1, edit.error);
}

report.section('12. a closed or expired listing can go back to being a draft');
{
  const [first, second] = (
    await db.query(`select id from jobs where company_id = '${ROWAD}' and status = 'active' order by id limit 2`)
  ).rows.map((row) => row.id);
  const results = await scenario([
    { as: E1, sql: `update jobs set status = 'closed' where id = '${first}' returning status` },
    { as: E1, sql: `update jobs set status = 'draft', title_ar = title_ar || ' (معدل)' where id = '${first}' returning status` },
    { as: null, sql: `update jobs set expires_at = now() - interval '1 hour', status = 'expired' where id = '${second}'` },
    { as: E1, sql: `update jobs set status = 'draft' where id = '${second}' returning status` },
    { as: E1, sql: `update jobs set status = 'active' where id = '${first}' returning status` },
  ]);
  const [closed, closedDraft, , expiredDraft, publish] = results;
  report.check('the owner closes a listing', closed.rows[0]?.status === 'closed', closed.error);
  report.check('and saves it as a draft', closedDraft.rows[0]?.status === 'draft', closedDraft.error);
  report.check('an expired listing can be kept as a draft too', expiredDraft.rows[0]?.status === 'draft', expiredDraft.error);
  report.check('but publishing is still review\'s', refused(publish, /job status cannot go from draft to active/), JSON.stringify(publish.rows[0] ?? publish.error));
}

report.section("13. a moderator's note on a listing is its company's to read (347)");
{
  const applied = await one(`
    select a.candidate_id, j.id as job from applications a join jobs j on j.id = a.job_id
     where j.company_id = '${ROWAD}' and j.status = 'active' order by a.id limit 1`);
  const NOTE = 'ملاحظة المراجع: الراتب المعلن غير حقيقي';
  const [unpublished, column, candidateNote, outsiderNote, companyNote, bell, snapshot, write, restored, afterRestore] =
    await scenario([
      { as: admin, sql: `select admin_moderate_job('${applied.job}', 'unpublish', '${NOTE}')` },
      { as: applied.candidate_id, sql: `select status, rejection_note from jobs where id = '${applied.job}'` },
      { as: applied.candidate_id, sql: `select rejection_note from job_moderation where job_id = '${applied.job}'` },
      { as: E2, sql: `select rejection_note from job_moderation where job_id = '${applied.job}'` },
      { as: E1, sql: `select rejection_note from job_moderation where job_id = '${applied.job}'` },
      { as: E1, sql: `select payload->>'note' as note from notifications where user_id = '${E1}' and kind = 'job_rejected' and payload->>'job_id' = '${applied.job}'` },
      { as: null, sql: `select appeal_decision_snapshot('${E1}', 'job', '${applied.job}')->>'note' as note` },
      { as: null, sql: `update jobs set rejection_note = 'مكتوبة في الإعلان' where id = '${applied.job}'` },
      { as: admin, sql: `select admin_moderate_job('${applied.job}', 'restore', 'رجع بعد المراجعة')` },
      { as: null, sql: `select count(*)::int as n from job_moderation where job_id = '${applied.job}'` },
    ]);
  report.check('an admin takes a live listing down with a reason', unpublished.ok, unpublished.error);
  report.check(
    'a candidate who applied reads the listing taken down, and neither in it nor beside it the reason',
    column.rows[0]?.status === 'rejected' && column.rows[0]?.rejection_note === null && candidateNote.ok && candidateNote.rows.length === 0,
    JSON.stringify({ listing: column.rows[0] ?? column.error, note: candidateNote.rows }),
  );
  report.check('another company reads nothing of it', outsiderNote.ok && outsiderNote.rows.length === 0, JSON.stringify(outsiderNote.rows));
  report.check('the listing\'s company reads the reason', companyNote.rows[0]?.rejection_note === NOTE, JSON.stringify(companyNote.rows[0] ?? companyNote.error));
  report.check('and its bell quotes it', bell.rows[0]?.note === NOTE, JSON.stringify(bell.rows[0] ?? bell.error));
  report.check('an appeal against it shows the reason it answers', snapshot.rows[0]?.note === NOTE, JSON.stringify(snapshot.rows[0] ?? snapshot.error));
  report.check('nothing writes a note into the listing itself', refused(write, /jobs_rejection_note_is_private/), JSON.stringify(write.error ?? write.rows));
  report.check('putting the listing back clears its note', restored.ok && afterRestore.rows[0]?.n === 0, JSON.stringify(restored.error ?? afterRestore.rows[0]));
}

report.section("14. a suspended company does not see its applicants (349)");
{
  const applied = await one(`
    select a.id, a.candidate_id from applications a join jobs j on j.id = a.job_id
     where j.company_id = '${ROWAD}' order by a.id limit 1`);
  const mine = `select count(*)::int as n from applications a join jobs j on j.id = a.job_id where j.company_id = '${ROWAD}'`;
  // A developer tag the company's first listing does not have yet.
  const tag = await one(`
    select j.id as job_id, d.id as developer_id from jobs j cross join developers d
     where j.company_id = '${ROWAD}'
       and not exists (select 1 from job_developers x where x.job_id = j.id and x.developer_id = d.id)
     order by j.id, d.id limit 1`);
  const digest = {
    as: null,
    sql: `select count(*)::int as n from pending_applicant_digests('30 days') d
           join company_members m on m.user_id = d.user_id where m.company_id = '${ROWAD}'`,
  };
  const steps = [
    // An applicant the owner has not opened, from today, and an owner who
    // takes the daily digest: the company is in it.
    { as: null, sql: `update profiles set notify_applications = true, notify_applicant_digest = true where id = '${E1}'` },
    { as: null, sql: `update applications set created_at = now() - interval '1 hour', employer_viewed_at = null where id = '${applied.id}'` },
    digest,
    { as: E1, sql: mine },
    { as: E1, sql: `select whatsapp_phone from profiles where id = '${applied.candidate_id}'` },
    { as: admin, sql: `select admin_set_company_suspension('${ROWAD}', true, 'سبب داخلي')` },
    { as: E1, sql: mine },
    { as: E1, sql: `select whatsapp_phone from profiles where id = '${applied.candidate_id}'` },
    { as: E1, sql: `select count(*)::int as n from application_events where application_id = '${applied.id}'` },
    { as: E1, sql: `update applications set status = 'shortlisted' where id = '${applied.id}' returning id` },
    { as: E1, sql: `insert into application_notes (application_id, author_id, body) values ('${applied.id}', '${E1}', 'ملاحظة') returning id` },
    { as: applied.candidate_id, sql: `select status from applications where id = '${applied.id}'` },
    digest,
    { as: E1, sql: `insert into job_developers (job_id, developer_id) values ('${tag.job_id}', '${tag.developer_id}') returning job_id` },
    { as: E1, sql: `delete from job_developers where job_id = '${tag.job_id}' and developer_id = '${tag.developer_id}' returning job_id` },
    { as: admin, sql: `select admin_set_company_suspension('${ROWAD}', false, 'رجعت بعد المراجعة')` },
    { as: E1, sql: mine },
    { as: E1, sql: `select whatsapp_phone from profiles where id = '${applied.candidate_id}'` },
  ];
  const [, , digestBefore, before, phoneBefore, suspended, during, phoneDuring, events, moved, noted, candidateOwn, digestDuring, tagged, untagged, lifted, after, phoneAfter] =
    await scenario(steps);
  report.check(
    "(before: the company reads its applicants and their numbers)",
    before.rows[0]?.n > 0 && Boolean(phoneBefore.rows[0]?.whatsapp_phone),
    JSON.stringify({ n: before.rows[0], phone: phoneBefore.rows.length }),
  );
  report.check('(an admin suspends it)', suspended.ok, suspended.error);
  report.check(
    'suspended, it reads none of its applications, nor any applicant\'s number',
    during.rows[0]?.n === 0 && phoneDuring.ok && phoneDuring.rows.length === 0,
    JSON.stringify({ n: during.rows[0], phone: phoneDuring.rows }),
  );
  report.check('nor the history of a move', events.rows[0]?.n === 0, JSON.stringify(events.rows[0] ?? events.error));
  report.check(
    'and moves nobody and writes no note',
    moved.ok && moved.rows.length === 0 && !noted.ok,
    JSON.stringify({ moved: moved.rows, noted: noted.error ?? noted.rows }),
  );
  report.check('the candidate still reads their own application', candidateOwn.rows.length === 1, JSON.stringify(candidateOwn.rows));
  report.check(
    'the daily digest, which counted it, leaves the company out',
    digestBefore.rows[0]?.n > 0 && digestDuring.rows[0]?.n === 0,
    JSON.stringify({ before: digestBefore.rows[0] ?? digestBefore.error, during: digestDuring.rows[0] ?? digestDuring.error }),
  );
  report.check(
    "its listings' developer tags stay its own to change, as a draft's text does",
    tagged.ok && tagged.rows.length === 1 && untagged.ok && untagged.rows.length === 1,
    JSON.stringify({ tagged: tagged.error ?? tagged.rows, untagged: untagged.error ?? untagged.rows }),
  );
  report.check(
    'lifted, everything comes back as it was',
    lifted.ok && after.rows[0]?.n === before.rows[0]?.n && phoneAfter.rows[0]?.whatsapp_phone === phoneBefore.rows[0]?.whatsapp_phone,
    JSON.stringify({ n: after.rows[0], lifted: lifted.error }),
  );
}

await db.close();
process.exit(report.finish() ? 0 : 1);
