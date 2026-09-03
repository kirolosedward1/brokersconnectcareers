/**
 * The security properties the product actually rests on, exercised against the
 * real policies and triggers. Run with: pnpm test:db
 */
import { createTestDb, runner, reporter, FIXTURES } from './setup.mjs';

const report = reporter();
const db = await createTestDb();
const as = runner(db);

const { employerVerified, employerUnverified, candidate, publicAgent, hiddenAgent, admin } =
  FIXTURES;
const OUTSIDER = '55555555-5555-5555-5555-555555555555';

await db.exec(`
  insert into auth.users (id, email) values ('${OUTSIDER}', 'outsider@demo.test');
  insert into profiles (id, role, full_name, whatsapp_phone)
    values ('${OUTSIDER}', 'candidate', 'زائر', '+201555555555');
`);

const liveJob = (
  await db.query("select id from jobs where slug='property-consultant-primary-new-cairo-562624'")
).rows[0].id;
const unverifiedCo = (await db.query("select id from companies where slug='property-hub-297685'")).rows[0].id;

// Deliberately the *unverified* company's pending listing: the post cap and the
// owner-cannot-publish rules both need a job whose owner is not verified.
const draftJob = (
  await db.query(
    `select id from jobs where status = 'pending_review' and company_id = '${unverifiedCo}'`,
  )
).rows[0].id;

report.section('unverified employers are capped at one active post');
{
  const r = await as(null, `update jobs set status='active' where id='${draftJob}'`, 'service_role');
  report.check('a second active post is refused',
    !r.ok && /unverified_company_post_cap/.test(r.error ?? ''), r.error);

  const r2 = await as(admin, `update jobs set status='active' where id='${draftJob}'`);
  report.check('and an admin cannot approve past it either',
    !r2.ok && /unverified_company_post_cap/.test(r2.error ?? ''), r2.error);

  await db.exec(`update companies set verification_status='verified' where id='${unverifiedCo}'`);
  const r3 = await as(null, `update jobs set status='active' where id='${draftJob}' returning status`, 'service_role');
  report.check('a verified company is not capped', r3.ok && r3.rows.length === 1, r3.error);
  await db.exec(`update companies set verification_status='unverified' where id='${unverifiedCo}'`);
}

report.section('publishing is a moderation action');
{
  const r = await as(employerUnverified, `update jobs set status='active' where id='${draftJob}'`);
  report.check('the owner cannot publish their own draft',
    !r.ok && /job status cannot go from/.test(r.error ?? ''), r.ok ? 'update was allowed' : r.error);
  report.check('and the refusal explains why',
    !r.ok && /Publishing is a moderation action/.test(r.hint ?? ''), r.hint ?? r.error);

  const r2 = await as(employerVerified, `update jobs set status='active' where id='${draftJob}' returning id`);
  report.check('a different employer cannot touch it at all', r2.ok && r2.rows.length === 0);

  const r3 = await as(employerUnverified, `update jobs set status='draft' where id='${draftJob}' returning status`);
  report.check('the owner can withdraw it to draft', r3.ok && r3.rows.length === 1, r3.error);

  const r4 = await as(employerUnverified, `update jobs set is_featured=true where id='${draftJob}'`);
  report.check('the owner cannot self-feature',
    !r4.ok && /featured placement/.test(r4.error ?? ''), r4.ok ? 'update was allowed' : r4.error);

  const r5 = await as(employerVerified, `update jobs set view_count=99999 where id='${liveJob}'`);
  report.check('the owner cannot inflate their view count',
    !r5.ok && /view_count/.test(r5.error ?? ''), r5.ok ? 'update was allowed' : r5.error);
}

report.section('verification and credits are granted, never claimed');
{
  const r = await as(employerUnverified, `update companies set verification_status='verified' where id='${unverifiedCo}'`);
  report.check('an owner cannot self-verify', !r.ok, r.ok ? 'update was allowed' : r.error);

  const r2 = await as(employerUnverified, `update companies set post_credits=99 where id='${unverifiedCo}'`);
  report.check('an owner cannot mint credits', !r2.ok, r2.ok ? 'update was allowed' : r2.error);

  const r3 = await as(employerUnverified, `update companies set name_ar='اسم جديد' where id='${unverifiedCo}' returning name_ar`);
  report.check('but can still edit their own company', r3.ok && r3.rows.length === 1, r3.error);

  const r4 = await as(admin, `update companies set verification_status='verified' where id='${unverifiedCo}' returning verification_status`);
  report.check('an admin can verify', r4.ok && r4.rows.length === 1, r4.error);

  const r5 = await as(OUTSIDER, `update profiles set role='admin' where id='${OUTSIDER}'`);
  report.check('nobody self-assigns the admin role', !r5.ok, r5.ok ? 'update was allowed' : r5.error);
}

report.section('unsubscribe tokens are not user-writable');
{
  const r = await as(OUTSIDER, `update profiles set unsubscribe_token=gen_random_uuid() where id='${OUTSIDER}'`);
  report.check('an owner cannot rotate their own token', !r.ok, r.ok ? 'update was allowed' : r.error);

  const r2 = await as(OUTSIDER, `update profiles set unsubscribe_token=gen_random_uuid() where id='${candidate}'`);
  report.check('nor anyone else\'s', !r2.ok || r2.rows?.length === 0, r2.ok && r2.rows?.length ? 'update was allowed' : r2.error);

  // The switches themselves are the point: the owner must be able to set them.
  const r3 = await as(OUTSIDER, `update profiles set notify_digest=false where id='${OUTSIDER}' returning notify_digest`);
  report.check('but can turn their own notifications off', r3.ok && r3.rows.length === 1, r3.error);
}

report.section('applications are private to the two parties');
{
  await db.exec(`insert into applications (job_id, candidate_id, experience_band)
                 values ('${liveJob}', '${candidate}', 'mid_3_5')`);

  const own = await as(candidate, 'select id, candidate_id from applications');
  report.check('the candidate sees their own and only their own',
    own.rows.length >= 1 && own.rows.every((row) => row.candidate_id === candidate),
    JSON.stringify(own.rows.length));

  const employer = await as(employerVerified, 'select job_id from applications');
  const ownJobs = await as(employerVerified, "select id from jobs where company_id = (select id from companies where slug = 'al-rowad-real-estate-309047')");
  const ownJobIds = new Set(ownJobs.rows.map((row) => row.id));
  report.check('the hiring employer sees applications to their jobs only',
    employer.rows.length >= 1 && employer.rows.every((row) => ownJobIds.has(row.job_id)),
    JSON.stringify(employer.rows.length));

  const stranger = await as(OUTSIDER, 'select id from applications');
  report.check('an uninvolved candidate sees nothing', stranger.rows.length === 0);

  const anon = await as(null, 'select id from applications', 'anon');
  report.check('anonymous sees nothing', anon.rows.length === 0);

  const rewrite = await as(employerVerified, `update applications set note='tampered' where job_id='${liveJob}'`);
  report.check('the employer cannot rewrite the submission',
    !rewrite.ok && /only the application status/.test(rewrite.error ?? ''),
    rewrite.ok ? 'update was allowed' : rewrite.error);

  const move = await as(employerVerified, `update applications set status='shortlisted' where job_id='${liveJob}' returning status`);
  report.check('but can move it through the pipeline', move.ok && move.rows.length >= 1, move.error);
}

report.section('an employer may explain a decision, and nothing more');
{
  const appId = (
    await db.query(`select id from applications where job_id='${liveJob}' limit 1`)
  ).rows[0]?.id;

  if (!appId) {
    report.check('found an application to move', false, 'no seeded application on the live job');
  } else {
    const r = await as(employerVerified, `update applications
      set status='rejected', decision_note='الخبرة أقل من المطلوب للدور ده'
      where id='${appId}' returning decision_note`);
    report.check('the owner can move it and say why', r.ok && r.rows.length === 1, r.error);

    const r2 = await as(employerVerified, `update applications set cv_path='other/cv.pdf' where id='${appId}'`);
    report.check("but still cannot touch the candidate's CV", !r2.ok, r2.ok ? 'update was allowed' : r2.error);

    const r3 = await as(employerVerified, `update applications set note='rewritten' where id='${appId}'`);
    report.check('nor rewrite their note', !r3.ok, r3.ok ? 'update was allowed' : r3.error);

    // The candidate has no update policy at all, so this matches zero rows.
    const r4 = await as(candidate, `update applications set status='hired' where id='${appId}' returning id`);
    report.check('and the candidate cannot hire themselves', r4.ok && r4.rows.length === 0, r4.error);
  }
}

report.section('an employer reaches their applicant, and only their applicant');
{
  const visible = await as(employerVerified, `select whatsapp_phone from profiles where id='${candidate}'`);
  report.check('the hiring employer sees the phone number', visible.rows.length === 1);

  const hidden = await as(employerUnverified, `select whatsapp_phone from profiles where id='${candidate}'`);
  report.check('an unrelated employer does not', hidden.rows.length === 0);
}

report.section('the agent directory gate');
{
  const GATED = 'ahmed-mahmoud-818804'; // verified_employers_only
  const PUBLIC = 'menna-sherif-909521'; // public

  const anon = await as(null, 'select slug, is_unlocked, full_name from search_agents(null,null,null,null,60,0)', 'anon');
  const anonGated = anon.rows.find((row) => row.slug === GATED);
  const anonPublic = anon.rows.find((row) => row.slug === PUBLIC);

  report.check('anonymous sees the directory at all', anon.rows.length > 1, JSON.stringify(anon.error));
  report.check('a gated profile comes back with no name',
    anonGated?.is_unlocked === false && anonGated?.full_name === null, JSON.stringify(anonGated));
  report.check('a public profile keeps its name',
    anonPublic?.is_unlocked === true && anonPublic?.full_name !== null, JSON.stringify(anonPublic));

  const unverified = await as(employerUnverified, 'select slug, full_name from search_agents(null,null,null,null,60,0)');
  report.check('an unverified employer still gets no name on gated rows',
    unverified.rows.find((row) => row.slug === GATED)?.full_name === null);

  const verified = await as(employerVerified, 'select slug, is_unlocked, full_name from search_agents(null,null,null,null,60,0)');
  const verifiedGated = verified.rows.find((row) => row.slug === GATED);
  report.check('a verified employer gets the name',
    verifiedGated?.is_unlocked === true && verifiedGated?.full_name !== null);

  const phoneAnon = await as(null, `select whatsapp_phone from get_agent_card('${GATED}')`, 'anon');
  report.check('anonymous gets no contact details', phoneAnon.rows[0]?.whatsapp_phone === null);

  const phoneVerified = await as(employerVerified, `select whatsapp_phone from get_agent_card('${GATED}')`);
  report.check('a verified employer gets contact details', phoneVerified.rows[0]?.whatsapp_phone !== null);

  const raw = await as(null, `select id from agent_profiles where slug = '${GATED}'`, 'anon');
  report.check('and the gated row is unreadable directly', raw.rows.length === 0);

  const rawPublic = await as(null, `select id from agent_profiles where slug = '${PUBLIC}'`, 'anon');
  report.check('while a public row is readable directly', rawPublic.rows.length === 1);
}

report.section('a CV section never outlives the gate on its profile');
{
  // hiddenAgent's profile is invisible to everyone but its owner. Its work
  // history names an employer, which is the most identifying field on the page.
  const hiddenId = (
    await db.query(`select id from agent_profiles where user_id = '${hiddenAgent}'`)
  ).rows[0].id;
  const publicId = (
    await db.query(`select id from agent_profiles where user_id = '${publicAgent}'`)
  ).rows[0].id;

  await db.exec(`
    insert into agent_experience (agent_id, company_name, title, started)
    values ('${hiddenId}', 'شركة صاحب العمل الحالي', 'استشاري أول', '2023-01-01'),
           ('${publicId}',  'شركة معلنة',            'استشاري',     '2022-01-01');
    insert into agent_education (agent_id, institution)
    values ('${hiddenId}', 'جامعة القاهرة');
    insert into agent_certifications (agent_id, name)
    values ('${hiddenId}', 'شهادة وسيط عقاري');
  `);

  const r = await as(OUTSIDER, `select company_name from agent_experience`);
  report.check(
    'a stranger sees no hidden employer name',
    r.ok && !r.rows.some((row) => row.company_name.includes('الحالي')),
    JSON.stringify(r.rows),
  );
  report.check('but does see the public one', r.ok && r.rows.length === 1, r.error);

  const r2 = await as(employerVerified, `select company_name from agent_experience`);
  report.check(
    'nor does a verified employer',
    r2.ok && !r2.rows.some((row) => row.company_name.includes('الحالي')),
    JSON.stringify(r2.rows),
  );

  const r3 = await as(OUTSIDER, `select institution from agent_education`);
  report.check('education is gated too', r3.ok && r3.rows.length === 0, JSON.stringify(r3.rows));

  const r4 = await as(OUTSIDER, `select name from agent_certifications`);
  report.check('and certifications', r4.ok && r4.rows.length === 0, JSON.stringify(r4.rows));

  // The owner sees their own row and the public one — two, not one.
  const r5 = await as(hiddenAgent, `select company_name from agent_experience`);
  report.check(
    'the owner still sees their own',
    r5.ok && r5.rows.some((row) => row.company_name.includes('الحالي')),
    JSON.stringify(r5.rows),
  );

  const r6 = await as(OUTSIDER, `insert into agent_experience (agent_id, company_name, title, started)
                                 values ('${publicId}', 'مزوّر', 'مزوّر', '2024-01-01')`);
  report.check('nobody writes onto another profile', !r6.ok, r6.ok ? 'insert was allowed' : r6.error);

  await db.exec(`delete from agent_experience; delete from agent_education; delete from agent_certifications;`);
}

report.section('an employed agent can hide from their own employer');
{
  // mostafa-elgendy is seeded `hidden` — this is the demo dataset's own proof.
  const HIDDEN = 'mostafa-elgendy-339125';

  const verified = await as(employerVerified, 'select slug from search_agents(null,null,null,null,60,0)');
  report.check('a hidden profile is absent even for a verified employer',
    !verified.rows.some((row) => row.slug === HIDDEN), JSON.stringify(verified.rows.map((r) => r.slug)));

  const admin_ = await as(admin, 'select slug from search_agents(null,null,null,null,60,0)');
  report.check('and absent for an admin browsing the directory',
    !admin_.rows.some((row) => row.slug === HIDDEN));

  const bySlug = await as(employerVerified, `select slug from get_agent_card('${HIDDEN}')`);
  report.check('and cannot be fetched by slug', bySlug.rows.length === 0);

  const owner = await as(hiddenAgent, `select slug from agent_profiles where slug = '${HIDDEN}'`);
  report.check('the owner still sees their own profile', owner.rows.length === 1);
}

report.section('verification documents never leak');
{
  await db.exec(`insert into company_documents (company_id, doc_type, storage_path)
                 values ('${unverifiedCo}', 'commercial_register', '${unverifiedCo}/cr.pdf')`);

  report.check('the owner sees their own',
    (await as(employerUnverified, 'select id from company_documents')).rows.length === 1);
  report.check('another employer sees nothing',
    (await as(employerVerified, 'select id from company_documents')).rows.length === 0);
  report.check('anonymous sees nothing',
    (await as(null, 'select id from company_documents', 'anon')).rows.length === 0);
  report.check('an admin sees it',
    (await as(admin, 'select id from company_documents')).rows.length === 1);
}

report.section('the public board shows live listings only');
{
  report.check('drafts are invisible to the public',
    (await as(null, "select id from jobs where status='draft'", 'anon')).rows.length === 0);
  report.check('pending review is invisible to the public',
    (await as(null, "select id from jobs where status='pending_review'", 'anon')).rows.length === 0);
  report.check('but the owner sees their own pending listing',
    (await as(employerUnverified, "select id from jobs where status='pending_review'")).rows.length >= 1);
}

report.section('unauthenticated writes do not crash the guards');
{
  // PostgREST sets request.jwt.claims to '' when no JWT is present, and
  // ''::jsonb raises 22P02. This is the exact shape that broke acting_as_admin.
  await db.exec("set request.jwt.claims = ''");
  let ok = true;
  let message = '';
  try {
    await db.exec(`update jobs set view_count = view_count where id='${liveJob}'`);
  } catch (error) {
    ok = false;
    message = error.message;
  }
  report.check('a guarded update survives empty jwt claims', ok, message);
  await db.exec('reset request.jwt.claims');
}

report.section('saved searches are private to their owner');
{
  // Seeded outside as(), because as() rolls every probe back.
  await db.exec(`insert into saved_searches (candidate_id, label, query)
                 values ('${candidate}', 'بيع أول التجمع', 'track=primary&district=new-cairo')`);

  const r = await as(candidate, `select id from saved_searches`);
  report.check('the owner sees their own', r.ok && r.rows.length === 1, r.error);

  const r2 = await as(OUTSIDER, `select id from saved_searches`);
  report.check('another user sees none of them', r2.ok && r2.rows.length === 0, r2.error);

  const r3 = await as(OUTSIDER, `update saved_searches set label='مسروق' returning id`);
  report.check('nor can edit them', r3.ok && r3.rows.length === 0, r3.error);

  const r4 = await as(candidate, `update saved_searches set last_sent_at=now()`);
  report.check('the owner cannot fake last_sent_at', !r4.ok, r4.ok ? 'update was allowed' : r4.error);

  const r5 = await as(candidate, `update saved_searches set alerts=false returning alerts`);
  report.check('but can turn its alerts off', r5.ok && r5.rows.length === 1, r5.error);

  // Nine more takes the owner to the cap of ten; the eleventh must be refused.
  await db.exec(`insert into saved_searches (candidate_id, label, query)
                 select '${candidate}', 'بحث ' || g, 'q=' || g from generate_series(1, 9) g`);
  const r6 = await as(candidate, `insert into saved_searches (candidate_id, label, query)
                                  values ('${candidate}', 'واحد زيادة', 'q=over')`);
  report.check('and cannot save more than ten', !r6.ok, r6.ok ? 'insert was allowed' : r6.error);

  await db.exec(`delete from saved_searches`);
}

report.section('a retried payment webhook cannot sell the same pack twice');
{
  const before = (await db.query(`select post_credits from companies where id='${unverifiedCo}'`)).rows[0].post_credits;

  const orderId = (
    await db.query(`insert into orders (company_id, pack_key, credits, amount_egp)
                    values ('${unverifiedCo}', 'bulk', 1, 3000) returning id`)
  ).rows[0].id;

  const first = (await db.query(`select public.settle_order('${orderId}', 'pm_test_1', true) as r`)).rows[0].r;
  report.check('the first delivery settles it', first === 'paid', `got ${first}`);

  const afterFirst = (await db.query(`select post_credits from companies where id='${unverifiedCo}'`)).rows[0].post_credits;
  report.check('and grants the credits', afterFirst === before + 1, `${before} -> ${afterFirst}`);

  const second = (await db.query(`select public.settle_order('${orderId}', 'pm_test_1', true) as r`)).rows[0].r;
  report.check('the retry is refused', second === 'already_paid', `got ${second}`);

  const afterSecond = (await db.query(`select post_credits from companies where id='${unverifiedCo}'`)).rows[0].post_credits;
  report.check('and grants nothing the second time', afterSecond === afterFirst, `${afterFirst} -> ${afterSecond}`);

  // A second row cannot claim the same provider order id.
  const dupe = await as(admin, `insert into orders (company_id, pack_key, credits, amount_egp, paymob_order_id)
                                values ('${unverifiedCo}', 'single', 1, 1000, 'pm_test_1')`);
  report.check('nor can a second order claim that payment', !dupe.ok, dupe.ok ? 'insert was allowed' : dupe.error);

  // A failed payment grants nothing.
  const failedId = (
    await db.query(`insert into orders (company_id, pack_key, credits, amount_egp)
                    values ('${unverifiedCo}', 'single', 1, 1000) returning id`)
  ).rows[0].id;
  const failed = (await db.query(`select public.settle_order('${failedId}', 'pm_test_2', false) as r`)).rows[0].r;
  const afterFailed = (await db.query(`select post_credits from companies where id='${unverifiedCo}'`)).rows[0].post_credits;
  report.check('a declined payment settles as failed', failed === 'failed', `got ${failed}`);
  report.check('and grants no credits', afterFailed === afterSecond, `${afterSecond} -> ${afterFailed}`);

  // And no signed-in user can reach it.
  const byUser = await as(employerUnverified, `select public.settle_order('${failedId}', 'pm_x', true)`);
  report.check('an employer cannot settle their own order', !byUser.ok, byUser.ok ? 'call was allowed' : byUser.error);

  await db.exec(`delete from orders`);
}

report.section('the nightly expiry cron');
{
  await db.exec("update jobs set expires_at = now() - interval '1 day' where status='active'");
  const before = (await db.query("select count(*)::int as n from jobs where status='active'")).rows[0].n;
  const expired = (await db.query('select expire_stale_jobs() as n')).rows[0].n;
  const after = (await db.query("select count(*)::int as n from jobs where status='active'")).rows[0].n;

  report.check(`past-window listings flip to expired (${before} → ${after})`,
    expired === before && after === 0);

  const publicCall = await as(null, 'select expire_stale_jobs()', 'anon');
  report.check('and the public cannot call it', !publicCall.ok, 'call was allowed');

  const userCall = await as(candidate, 'select expire_stale_jobs()');
  report.check('nor can a signed-in user', !userCall.ok, 'call was allowed');
}

process.exit(report.finish() ? 0 : 1);
