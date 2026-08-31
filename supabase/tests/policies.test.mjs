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
  await db.query("select id from jobs where slug='property-consultant-primary-new-cairo-a1b2'")
).rows[0].id;
const unverifiedCo = (await db.query("select id from companies where slug='property-hub'")).rows[0].id;

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

report.section('applications are private to the two parties');
{
  await db.exec(`insert into applications (job_id, candidate_id, experience_band)
                 values ('${liveJob}', '${candidate}', 'mid_3_5')`);

  const own = await as(candidate, 'select id, candidate_id from applications');
  report.check('the candidate sees their own and only their own',
    own.rows.length >= 1 && own.rows.every((row) => row.candidate_id === candidate),
    JSON.stringify(own.rows.length));

  const employer = await as(employerVerified, 'select job_id from applications');
  const ownJobs = await as(employerVerified, "select id from jobs where company_id = (select id from companies where slug = 'al-rowad-real-estate')");
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

report.section('an employer reaches their applicant, and only their applicant');
{
  const visible = await as(employerVerified, `select whatsapp_phone from profiles where id='${candidate}'`);
  report.check('the hiring employer sees the phone number', visible.rows.length === 1);

  const hidden = await as(employerUnverified, `select whatsapp_phone from profiles where id='${candidate}'`);
  report.check('an unrelated employer does not', hidden.rows.length === 0);
}

report.section('the agent directory gate');
{
  const GATED = 'ahmed-mahmoud-x9y8'; // verified_employers_only
  const PUBLIC = 'menna-sherif-p2q3'; // public

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

report.section('an employed agent can hide from their own employer');
{
  // mostafa-elgendy is seeded `hidden` — this is the demo dataset's own proof.
  const HIDDEN = 'mostafa-elgendy-v8w9';

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
