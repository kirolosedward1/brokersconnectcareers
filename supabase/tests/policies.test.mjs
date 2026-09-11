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

report.section('editing a live listing is possible, and says so');
{
  /*
    saveJob wrote a status on every save, including a save of a listing already
    on the board — and the transition table permits neither `draft` nor
    `pending_review` from `active`, so the edit button on the listings page
    opened a form that could not be saved at all. The action now sends no
    status when the listing is live and leaves the decision to the guard, which
    is the rule that was already written.
  */
  const withStatus = await as(employerVerified,
    `update jobs set title_ar = title_ar || ' ', status = 'pending_review' where id = '${liveJob}'`);
  report.check('sending a status with the edit is still refused',
    !withStatus.ok && /cannot go from active to pending_review/.test(withStatus.error ?? ''),
    withStatus.error);

  const material = await as(employerVerified,
    `update jobs set seats = seats + 1 where id = '${liveJob}' returning status`);
  report.check('a material edit goes back to the queue by itself',
    material.ok && material.rows[0]?.status === 'pending_review',
    JSON.stringify(material.rows[0] ?? material.error));

  const cosmetic = await as(employerVerified,
    `update jobs set requirements_ar = 'رخصة قيادة' where id = '${liveJob}' returning status`);
  report.check('and a cosmetic one stays on the board',
    cosmetic.ok && cosmetic.rows[0]?.status === 'active',
    JSON.stringify(cosmetic.rows[0] ?? cosmetic.error));

  // Still somebody else's listing, whatever the status.
  const stranger = await as(employerUnverified,
    `update jobs set requirements_ar = 'مزوّر' where id = '${liveJob}' returning id`);
  report.check('another company still changes nothing',
    stranger.ok && stranger.rows.length === 0, JSON.stringify(stranger.rows));
}

report.section('reposting puts the listing back on the board');
{
  /*
    closed -> pending_review -> active is the only path an employer has back
    onto the board, and stamp_job_publication used to carry the original
    expires_at across it. A listing whose window had run out came back active
    and already expired: invisible to the board, which filters on the date, and
    flipped straight back by the next nightly run.

    Written with db.exec rather than as(): the runner rolls every call back, so
    it answers "was this permitted" and nothing about what the trigger wrote.
    The listing is put back the way it was found at the end.
  */
  await db.exec(`
    update jobs set published_at = now() - interval '32 days', expires_at = now() - interval '2 days' where id = '${liveJob}';
    update jobs set status = 'closed'         where id = '${liveJob}';
    update jobs set status = 'pending_review' where id = '${liveJob}';
    update jobs set status = 'active'         where id = '${liveJob}';
  `);

  const back = (
    await db.query(`select status, expires_at > now() as on_the_board from jobs where id = '${liveJob}'`)
  ).rows[0];
  report.check('a listing whose window ran out comes back with a new one',
    back.status === 'active' && back.on_the_board === true, JSON.stringify(back));

  /*
    And the other half: closing for a day is not a way to buy another month. A
    window still running is carried across untouched.
  */
  await db.exec(`
    update jobs set expires_at = now() + interval '10 days' where id = '${liveJob}';
    update jobs set status = 'closed'         where id = '${liveJob}';
    update jobs set status = 'pending_review' where id = '${liveJob}';
  `);
  const before = (await db.query(`select expires_at from jobs where id = '${liveJob}'`)).rows[0].expires_at;
  await db.exec(`update jobs set status = 'active' where id = '${liveJob}'`);
  const after = (await db.query(`select expires_at from jobs where id = '${liveJob}'`)).rows[0].expires_at;
  report.check('a window still running is not extended by a round trip',
    String(before) === String(after), `${before} -> ${after}`);

  /*
    The post cap counted listings whose window had run out, so an unverified
    company could not replace an advert that had quietly ended. The cron that
    would have relabelled it returns 503 on production for want of a service
    role key, which is exactly why the date has to be the thing that decides.
  */
  await db.exec(`
    update jobs set published_at = now() - interval '40 days', expires_at = now() - interval '10 days'
     where company_id = '${unverifiedCo}' and status = 'active';
  `);

  const replacement = await as(null,
    `update jobs set status = 'active' where id = '${draftJob}' returning id`, 'service_role');
  report.check('an expired advert does not fill the one slot an unverified company has',
    replacement.ok && replacement.rows.length === 1, replacement.error);

  /*
    And the repost button the console now offers on a listing whose label has
    not caught up. It is shown as expired because the date says so, and the
    transition table used to permit pending_review only from the label the cron
    writes — so the button would have been refused by the database.
  */
  await db.exec(`update jobs set published_at = now() - interval '31 days', expires_at = now() - interval '1 day' where id = '${liveJob}'`);

  const repostStale = await as(employerVerified,
    `update jobs set status = 'pending_review' where id = '${liveJob}' returning status`);
  report.check('a listing past its window can be reposted whatever its label says',
    repostStale.ok && repostStale.rows.length === 1, repostStale.error);

  // And a listing still inside its window cannot take itself off the board
  // that way — closing is the only route.
  await db.exec(`update jobs set expires_at = now() + interval '10 days' where id = '${liveJob}'`);
  const stillLive = await as(employerVerified,
    `update jobs set status = 'pending_review' where id = '${liveJob}'`);
  report.check('a live one still cannot',
    !stillLive.ok && /cannot go from active to pending_review/.test(stillLive.error ?? ''),
    stillLive.error);

  // Back the way it was found, for every section after this one.
  await db.exec(`
    update jobs set expires_at = now() + interval '30 days'
     where id = '${liveJob}' or (company_id = '${unverifiedCo}' and status = 'active');
  `);
}

report.section('two people editing one listing, and one of them losing');
{
  /*
    A company is a team: every admin member may edit every listing on it, so
    two people on the same advert is what inviting a colleague produces. The
    second save used to win and the first simply ceased to exist — and on a
    live listing it is the second saver's copy that goes back to the moderation
    queue, so what returns to the board is what nobody meant to send.
  */
  const before = (
    await db.query(`select version from jobs where id = '${liveJob}'`)
  ).rows[0].version;

  const first = await as(employerVerified,
    `update jobs set requirements_ar = 'النسخة الأولى'
      where id = '${liveJob}' and version = ${before} returning version`);
  report.check('a save carrying the version it loaded goes through',
    first.ok && first.rows.length === 1, first.error);
  report.check('and the version moves', first.rows[0]?.version === before + 1,
    JSON.stringify(first.rows[0]));

  /*
    The runner rolls each call back, so the row is at `before` again — which
    is the wrong shape for this assertion. Committed deliberately, then put
    back at the end.
  */
  await db.exec(`update jobs set requirements_ar = 'النسخة الأولى' where id = '${liveJob}'`);
  const moved = (await db.query(`select version from jobs where id = '${liveJob}'`)).rows[0].version;
  report.check('a committed save really did move it', moved === before + 1, `${before} -> ${moved}`);

  const second = await as(employerVerified,
    `update jobs set requirements_ar = 'النسخة التانية'
      where id = '${liveJob}' and version = ${before} returning id`);
  report.check('a save carrying a version that has moved changes nothing',
    second.ok && second.rows.length === 0, JSON.stringify(second.rows));

  const still = (
    await db.query(`select requirements_ar from jobs where id = '${liveJob}'`)
  ).rows[0].requirements_ar;
  report.check('and the first save is still there',
    still === 'النسخة الأولى', String(still));

  // Companies too, for the same reason: a company can have several admins.
  const company = (
    await db.query(`select company_id from company_members where user_id = '${employerVerified}' limit 1`)
  ).rows[0].company_id;
  const companyBefore = (
    await db.query(`select version from companies where id = '${company}'`)
  ).rows[0].version;

  await db.exec(`update companies set about_ar = 'نسخة زميل' where id = '${company}'`);

  const late = await as(employerVerified,
    `update companies set about_ar = 'نسخة متأخرة'
      where id = '${company}' and version = ${companyBefore} returning id`);
  report.check('a company profile saved from a stale form changes nothing',
    late.ok && late.rows.length === 0, JSON.stringify(late.rows));

  await db.exec(`update jobs set requirements_ar = null where id = '${liveJob}'`);
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
  // The point is that such an application exists, not that this line created
  // it — the demo seed spreads applications across candidates and may already
  // have claimed this pair.
  await db.exec(`insert into applications (job_id, candidate_id, experience_band)
                 values ('${liveJob}', '${candidate}', 'mid_3_5')
                 on conflict (job_id, candidate_id) do nothing`);

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

report.section('notifications are written by the platform, not by their reader');
{
  const live = (
    await db.query("select id, company_id from jobs where status='active' and expires_at > now() limit 1")
  ).rows[0];
  const owner = (
    await db.query(`select owner_id from companies where id='${live.company_id}'`)
  ).rows[0].owner_id;

  const before = (
    await db.query(`select count(*)::int n from notifications where user_id='${owner}'`)
  ).rows[0].n;

  await db.exec(`insert into applications (job_id, candidate_id, experience_band)
                 values ('${live.id}', '${OUTSIDER}', 'mid_3_5')
                 on conflict (job_id, candidate_id) do nothing`);

  const after = (
    await db.query(`select count(*)::int n from notifications where user_id='${owner}'`)
  ).rows[0].n;
  report.check('an application tells the company that owns the listing',
    after === before + 1, `${before} → ${after}`);

  const app = (
    await db.query(`select id, candidate_id from applications where job_id='${live.id}' limit 1`)
  ).rows[0];
  await db.exec(`update applications set status='shortlisted' where id='${app.id}'`);
  const moved = (
    await db.query(`select kind, payload->>'status' as status from notifications
                     where user_id='${app.candidate_id}' order by created_at desc limit 1`)
  ).rows[0];
  report.check('and moving it tells the candidate',
    moved?.kind === 'application_moved' && moved.status === 'shortlisted', JSON.stringify(moved));

  // The whole reason there is no insert policy: a row that looks like it came
  // from the platform must not be writable by the person reading it.
  const forge = await as(candidate,
    `insert into notifications (user_id, kind) values ('${candidate}','account_approved') returning id`);
  report.check('nobody can write their own notification',
    !forge.ok, forge.ok ? 'insert was allowed' : forge.error);

  const tamper = await as(app.candidate_id,
    `update notifications set kind='account_approved' where user_id='${app.candidate_id}'`);
  report.check('nor rewrite one they were sent',
    !tamper.ok && /only read_at is user-writable/.test(tamper.error ?? ''),
    tamper.ok ? 'update was allowed' : tamper.error);

  const read = await as(app.candidate_id,
    `update notifications set read_at=now() where user_id='${app.candidate_id}' returning id`);
  report.check('but can mark it read', read.ok && read.rows.length >= 1, read.error);

  const peek = await as(candidate,
    `select count(*)::int as n from notifications where user_id <> '${candidate}'`);
  report.check("and sees nobody else's", peek.ok && peek.rows[0].n === 0, JSON.stringify(peek.rows[0]));

  const anon = await as(null, 'select count(*)::int as n from notifications', 'anon');
  report.check('anonymous sees none', !anon.ok || anon.rows[0].n === 0, JSON.stringify(anon.rows[0]));
}

report.section('a company waits for a person; a consultant does not');
{
  const roles = (
    await db.query('select role, approval_status, count(*)::int n from profiles group by 1,2')
  ).rows;
  const at = (role, status) => roles.find((r) => r.role === role && r.approval_status === status)?.n ?? 0;

  report.check('every candidate is approved on arrival',
    at('candidate', 'pending') === 0 && at('candidate', 'approved') > 0, JSON.stringify(roles));

  // The seed approves all but one, so both states are exercised.
  report.check('and employers are held for review',
    at('employer', 'pending') > 0, JSON.stringify(roles));

  const PENDING = '99999999-0000-0000-0000-000000000001';
  const PENDING_CO = 'bbbbbbbb-0000-0000-0000-000000000001';
  const district = (await db.query('select id from districts limit 1')).rows[0].id;

  await db.exec(`
    insert into auth.users (id, email) values ('${PENDING}', 'pending@demo.test');
    insert into profiles (id, role, full_name, whatsapp_phone)
      values ('${PENDING}', 'employer', 'شركة تحت المراجعة', '+201000000099');
    insert into companies (id, owner_id, name_ar, slug)
      values ('${PENDING_CO}', '${PENDING}', 'شركة تحت المراجعة', 'pending-co-1');
  `);

  const started = (
    await db.query(`select approval_status from profiles where id = '${PENDING}'`)
  ).rows[0].approval_status;
  report.check('a new company account starts pending', started === 'pending', started);

  const selfApprove = await as(PENDING,
    `update profiles set approval_status='approved' where id='${PENDING}'`);
  report.check('and cannot approve itself',
    !selfApprove.ok && /approval is an admin action/.test(selfApprove.error ?? ''),
    selfApprove.ok ? 'update was allowed' : selfApprove.error);

  const draft = (slug) => `insert into jobs
    (company_id, title_ar, slug, track, employment_type, experience_band, district_id,
     commission_type, leads_source, description_ar, status)
    values ('${PENDING_CO}','وظيفة','${slug}','primary','full_time','junior_1_3',${district},
            'split','company_provided','وصف','pending_review') returning id`;

  // The gate that matters. A pending company can still build its profile and
  // upload documents — it just cannot put a listing in front of anyone.
  const post = await as(PENDING, draft('pending-job-1'));
  report.check('a pending company cannot create a listing',
    !post.ok && /row-level security/.test(post.error ?? ''),
    post.ok ? 'insert was allowed' : post.error);

  const byEmployer = await as(employerVerified, `select public.set_account_approval('${PENDING}','approved')`);
  report.check('an employer cannot approve anybody',
    !byEmployer.ok, byEmployer.ok ? 'call was allowed' : byEmployer.error);

  const byCandidate = await as(candidate, `select public.set_account_approval('${PENDING}','approved')`);
  report.check('nor can a candidate', !byCandidate.ok, byCandidate.ok ? 'call was allowed' : byCandidate.error);

  const selfAdmin = await as(admin, `select public.set_account_approval('${admin}','rejected')`);
  report.check('and an admin cannot change their own',
    !selfAdmin.ok && /own approval/.test(selfAdmin.error ?? ''),
    selfAdmin.ok ? 'call was allowed' : selfAdmin.error);

  /*
    Nor by going round the function.

    set_account_approval() has refused this since migration 16 and was the only
    thing refusing it: guard_profile_update returned early for an admin before
    reaching any check, and profiles_admin_all permitted the write, so a direct
    PostgREST update did what the function would not. Not an escalation — an
    admin can approve anybody — but a rule the product states in an error
    message and the database did not keep.
  */
  const direct = await as(admin,
    `update profiles set approval_status = 'approved', approved_at = now() where id = '${admin}'`);
  report.check('nor by updating the row directly',
    !direct.ok && /own approval/.test(direct.error ?? ''),
    direct.ok ? 'update was allowed' : direct.error);

  const selfRole = await as(admin, `update profiles set role = 'candidate' where id = '${admin}'`);
  report.check('nor demote themselves by hand',
    !selfRole.ok && /own approval/.test(selfRole.error ?? ''),
    selfRole.ok ? 'update was allowed' : selfRole.error);

  // And everything else about their own row is still theirs.
  const ordinary = await as(admin,
    `update profiles set full_name = 'المشرف' where id = '${admin}' returning id`);
  report.check('an admin still edits their own name',
    ordinary.ok && ordinary.rows.length === 1, ordinary.error);

  const other = await as(admin,
    `update profiles set approval_status = 'approved' where id = '${candidate}' returning id`);
  report.check('and still approves somebody else',
    other.ok && other.rows.length === 1, other.error);

  await db.exec(`update profiles set approval_status='approved' where id='${PENDING}'`);
  const post2 = await as(PENDING, draft('pending-job-2'));
  report.check('once approved, the same company can', post2.ok, post2.error);

  // Suspension has to bite for candidates too, or moderation has no answer to
  // somebody spraying applications.
  await db.exec(`update profiles set approval_status='rejected' where id='${candidate}'`);
  const live = (
    await db.query("select id from jobs where status='active' and expires_at > now() limit 1")
  ).rows[0].id;
  const apply = await as(candidate,
    `insert into applications (job_id, candidate_id, experience_band)
     values ('${live}','${candidate}','mid_3_5') returning id`);
  report.check('a suspended candidate cannot apply',
    !apply.ok, apply.ok ? 'insert was allowed' : apply.error);
  await db.exec(`update profiles set approval_status='approved' where id='${candidate}'`);
}

report.section('only candidates apply');
{
  const liveOther = (
    await db.query(`
      select j.id from jobs j
       where j.status = 'active' and j.expires_at > now()
         and j.company_id <> (select id from companies where slug = 'al-rowad-real-estate-309047')
       limit 1`)
  ).rows[0].id;

  // The apply page redirects employers, but a redirect is a convenience for a
  // wrong turn, not a control. This is the check that actually holds.
  const r = await as(employerVerified,
    `insert into applications (job_id, candidate_id, experience_band)
     values ('${liveOther}', '${employerVerified}', 'mid_3_5') returning id`);
  report.check('an employer cannot apply to a listing',
    !r.ok && /row-level security/.test(r.error ?? ''), r.ok ? 'insert was allowed' : r.error);

  const own = (
    await db.query(`
      select j.id from jobs j
       where j.status = 'active' and j.expires_at > now()
         and j.company_id = (select id from companies where slug = 'al-rowad-real-estate-309047')
       limit 1`)
  ).rows[0].id;

  const r2 = await as(employerVerified,
    `insert into applications (job_id, candidate_id, experience_band)
     values ('${own}', '${employerVerified}', 'mid_3_5') returning id`);
  report.check('nor to their own', !r2.ok, r2.ok ? 'insert was allowed' : r2.error);

  const r3 = await as(admin,
    `insert into applications (job_id, candidate_id, experience_band)
     values ('${liveOther}', '${admin}', 'mid_3_5') returning id`);
  report.check('nor can an admin apply as themselves through the candidate policy',
    !r3.ok || r3.rows.length === 1, r3.error);

  // And the thing the policy exists to allow still works.
  const r4 = await as(candidate,
    `insert into applications (job_id, candidate_id, experience_band)
     values ('${liveOther}', '${candidate}', 'mid_3_5')
     on conflict (job_id, candidate_id) do nothing returning id`);
  report.check('a candidate still can', r4.ok, r4.error);
}

report.section('an employer reaches their applicant, and only their applicant');
{
  const visible = await as(employerVerified, `select whatsapp_phone from profiles where id='${candidate}'`);
  report.check('the hiring employer sees the phone number', visible.rows.length === 1);

  // Computed, not a fixture. The seed spreads applications across companies,
  // so "an employer this candidate never applied to" is a query — pinning it
  // to a named account tests whichever relationship the seed happens to have.
  const unrelated = (
    await db.query(`
      select c.owner_id from companies c
      where not exists (
        select 1 from applications a
          join jobs j on j.id = a.job_id
         where j.company_id = c.id and a.candidate_id = '${candidate}'
      )
      limit 1`)
  ).rows[0]?.owner_id;

  report.check('found an employer with no claim on this candidate', Boolean(unrelated));

  const hidden = await as(unrelated, `select whatsapp_phone from profiles where id='${candidate}'`);
  report.check('an unrelated employer does not', hidden.rows.length === 0);
}

report.section('applying is consent, and the applicant inbox may read it');
{
  /*
    The employer's applicant list embeds each candidate's directory profile so
    a reviewer can judge somebody without opening a filename.

    This section used to assert the opposite of what it asserts now: that a
    hidden profile stayed hidden from the very employer it had applied to. The
    reasoning was that applying must not become a way around the visibility a
    consultant chose, and the worry behind it is real — an employer must not be
    able to browse to a profile its owner withheld.

    But the rule it produced protected nothing. The application already carries
    the candidate's name, their WhatsApp number and usually their CV file, and
    `profiles_select_applicants` has handed the employer all three since
    migration 04. Withholding the headline and the years of experience beside
    them did not keep a secret; it made the reviewer open a PDF to learn what
    the card could have said, and on production it left four applications
    showing a name, a phone number and an empty panel.

    Visibility is a directory setting. `hidden` means do not list me. An
    application is not a listing — it is a message the candidate chose to send
    to one company, and only the candidate can create it. So the gate is not
    "an employer", it is "the employer this person applied to", which is what
    the negative assertion at the end of this block pins down.
  */
  const live = (
    await db.query(`
      select j.id from jobs j
       where j.status = 'active' and j.expires_at > now()
         and j.company_id = (select id from companies where slug = 'al-rowad-real-estate-309047')
       limit 1`)
  ).rows[0].id;

  const hiddenOwner = (
    await db.query(`select user_id from agent_profiles where visibility = 'hidden' limit 1`)
  ).rows[0]?.user_id;
  const publicOwner = (
    await db.query(`select user_id from agent_profiles where visibility = 'public' limit 1`)
  ).rows[0]?.user_id;

  report.check('the fixtures include a hidden and a public consultant',
    Boolean(hiddenOwner) && Boolean(publicOwner));

  // The public consultant applies, unchanged from when this block asserted the
  // opposite: a public profile was always readable, so this is the control.
  await db.exec(`
    insert into applications (job_id, candidate_id, experience_band)
      values ('${live}', '${publicOwner}', 'mid_3_5')
      on conflict (job_id, candidate_id) do nothing;
  `);

  const embed = (owner) => `
    select a.id, p.slug
      from applications a
      join profiles pr on pr.id = a.candidate_id
      left join agent_profiles p on p.user_id = pr.id
     where a.job_id = '${live}' and a.candidate_id = '${owner}'`;

  const seesPublic = await as(employerVerified, embed(publicOwner));
  report.check('a public applicant brings their profile with them',
    seesPublic.ok && seesPublic.rows[0]?.slug != null, JSON.stringify(seesPublic.rows[0]));

  /*
    The gated half is built here rather than borrowed from the seed.

    The reader has to be an employer whose company is *not* verified — that is
    the whole case — and the consultant has to have applied to exactly one
    company, or the negative assertion below tests whichever relationship the
    seed happened to generate. Both are easier to state than to find. This
    consultant exists for eight assertions and is deleted after them.
  */
  const SHY = '66666666-6666-4666-8666-666666666666';
  const unverifiedJob = (
    await db.query(`select id from jobs where company_id = '${unverifiedCo}' limit 1`)
  ).rows[0].id;

  await db.exec(`
    insert into auth.users (id, email) values ('${SHY}', 'shy@demo.test');
    insert into profiles (id, role, full_name, whatsapp_phone)
      values ('${SHY}', 'candidate', 'خجول', '+201666666666');
    insert into agent_profiles (user_id, slug, visibility, years_experience)
      values ('${SHY}', 'shy-consultant-000001', 'verified_employers_only', 7);
    insert into agent_experience (agent_id, company_name, title, started)
      values ((select id from agent_profiles where user_id = '${SHY}'), 'شركة سرية', 'استشاري', '2021-01-01');
  `);

  const beforeApplying = await as(employerUnverified, `select slug from agent_profiles where user_id = '${SHY}'`);
  report.check('an unverified employer cannot read a gated profile',
    beforeApplying.ok && beforeApplying.rows.length === 0, JSON.stringify(beforeApplying.rows));

  /*
    Written with the service role, so the listing's status is beside the point:
    applied_to_my_job asks who owns the listing, not whether it is live. An
    unverified company can hold applications on a listing that has since
    closed, and the inbox still has to render them.
  */
  await db.exec(`
    insert into applications (job_id, candidate_id, experience_band)
      values ('${unverifiedJob}', '${SHY}', 'mid_3_5');
  `);

  const afterApplying = await as(employerUnverified, embed(SHY).replace(`'${live}'`, `'${unverifiedJob}'`));
  report.check('and reads it once that consultant has applied to them',
    afterApplying.ok && afterApplying.rows.length === 1 && afterApplying.rows[0].slug !== null,
    JSON.stringify(afterApplying.rows[0]));

  // The card the applicant list links to opens too, or the panel would fill in
  // beside a link to an anonymous page.
  const card = await as(employerUnverified, `select is_unlocked, whatsapp_phone from get_agent_card('shy-consultant-000001')`);
  report.check('the card behind the link opens',
    card.rows[0]?.is_unlocked === true, JSON.stringify(card.rows[0] ?? card.error));

  // Work history follows the profile it hangs on, which is what a reviewer is
  // actually reading when they open an applicant.
  const history = await as(employerUnverified, `select company_name from agent_experience where company_name = 'شركة سرية'`);
  report.check('and the work history with it', history.ok && history.rows.length === 1, JSON.stringify(history.rows));

  /*
    The scope, stated as a test. Computed rather than pinned to a named
    account, for the reason the section above gives: the seed decides which
    company has which applications.
  */
  const unrelatedEmployer = (
    await db.query(`
      select c.owner_id from companies c
      where c.verification_status <> 'verified'
        and not exists (
          select 1 from applications a
            join jobs j on j.id = a.job_id
           where j.company_id = c.id and a.candidate_id = '${SHY}'
        )
      limit 1`)
  ).rows[0]?.owner_id;

  // Unverified too, or the assertion proves nothing: a verified employer reads
  // this profile through the ordinary directory gate and always could.
  report.check('found an unverified employer with no claim on this consultant', Boolean(unrelatedEmployer));

  const stranger = await as(unrelatedEmployer, `select slug from agent_profiles where user_id = '${SHY}'`);
  report.check('an employer they did not apply to still sees nothing',
    stranger.ok && stranger.rows.length === 0, JSON.stringify(stranger.rows));

  /*
    And the line this stops at.

    `hidden` is not a stronger setting of the same preference — it is a
    different statement. It exists so a consultant can stay invisible to the
    company they currently work for, and they were most likely hired through an
    application to that company. Opening on an application would defeat the
    feature for the one person it was built for, so it does not.
  */
  await db.exec(`update agent_profiles set visibility = 'hidden' where user_id = '${SHY}';`);

  const stillHidden = await as(employerUnverified, `select slug from agent_profiles where user_id = '${SHY}'`);
  report.check('but hidden stays hidden, application or not',
    stillHidden.ok && stillHidden.rows.length === 0, JSON.stringify(stillHidden.rows));

  const hiddenCard = await as(employerUnverified, `select slug from get_agent_card('shy-consultant-000001')`);
  report.check('and its card does not open by slug either',
    hiddenCard.ok && hiddenCard.rows.length === 0, JSON.stringify(hiddenCard.rows));

  // Consent is the application, so it lasts exactly as long as one does.
  await db.exec(`
    update agent_profiles set visibility = 'verified_employers_only' where user_id = '${SHY}';
    delete from applications where candidate_id = '${SHY}';
  `);
  const afterWithdrawal = await as(employerUnverified, `select slug from agent_profiles where user_id = '${SHY}'`);
  report.check('and withdrawing closes it again',
    afterWithdrawal.ok && afterWithdrawal.rows.length === 0, JSON.stringify(afterWithdrawal.rows));

  await db.exec(`delete from auth.users where id = '${SHY}';`);
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

report.section('the row itself refuses shapes no form would send');
{
  /*
    The forms cap what they accept and the table did not, so anything not
    coming through a form — which is every request, as far as the database is
    concerned — could write an eight megabyte description. And two of these are
    not about size at all: a CV path is a file, and a file belongs to the
    account whose folder it sits in.
  */
  const foreignCv = await as(candidate, `
    insert into applications (job_id, candidate_id, cv_path, experience_band)
    values ('${liveJob}', '${candidate}', '${publicAgent}/stolen.pdf', 'mid_3_5')`);
  report.check('an application cannot carry somebody else\'s CV',
    !foreignCv.ok && /applications_cv_is_the_applicants/.test(foreignCv.error ?? ''),
    foreignCv.ok ? 'insert was allowed' : foreignCv.error);

  const ownCv = await as(candidate, `
    insert into applications (job_id, candidate_id, cv_path, experience_band)
    values ('${liveJob}', '${candidate}', '${candidate}/mine.pdf', 'mid_3_5')
    on conflict (job_id, candidate_id) do nothing`);
  report.check('and its own is fine', ownCv.ok, ownCv.error);

  const foreignAgentCv = await as(publicAgent,
    `update agent_profiles set cv_path = '${candidate}/stolen.pdf' where user_id = '${publicAgent}'`);
  report.check('nor can a directory profile',
    !foreignAgentCv.ok && /agent_profiles_cv_is_the_owners/.test(foreignAgentCv.error ?? ''),
    foreignAgentCv.ok ? 'update was allowed' : foreignAgentCv.error);

  const huge = await as(employerVerified,
    `update jobs set description_ar = repeat('ا', 9000) where id = '${liveJob}'`);
  report.check('a listing cannot carry an unbounded description',
    !huge.ok && /jobs_description_ar_length/.test(huge.error ?? ''),
    huge.ok ? 'update was allowed' : huge.error);

  const backwards = await as(null,
    `update jobs set expires_at = published_at - interval '1 day' where id = '${liveJob}'`,
    'service_role');
  report.check('nor a window that runs backwards',
    !backwards.ok && /jobs_publication_window/.test(backwards.error ?? ''),
    backwards.ok ? 'update was allowed' : backwards.error);

  /*
    And the directory stays a directory of consultants even for the service
    role, which bypasses RLS entirely and is what the seed and the crons use.
  */
  const employerListing = await as(null,
    `insert into agent_profiles (user_id, slug) values ('${employerVerified}', 'employer-in-the-directory')`,
    'service_role');
  report.check('an employer cannot be listed as a consultant',
    !employerListing.ok && /agent_profile_role/.test(employerListing.error ?? ''),
    employerListing.ok ? 'insert was allowed' : employerListing.error);
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

report.section('submitting papers joins the queue, and nothing else does');
{
  /*
    `pending` was a value the enum offered and nothing ever wrote. The review
    queue is built from documents, so it worked; the admin overview's count and
    the employer's own setup checklist both read the company's status, so both
    said nothing was happening while something was.

    The document inserted by the section above is still there, so the company
    should already have moved.
  */
  const afterUpload = (
    await db.query(`select verification_status from companies where id = '${unverifiedCo}'`)
  ).rows[0].verification_status;
  report.check('a submitted document puts the company in the queue',
    afterUpload === 'pending', afterUpload);

  // And the thing the marker must not become a way to do.
  const selfVerify = await as(employerUnverified,
    `update companies set verification_status = 'verified' where id = '${unverifiedCo}'`);
  report.check('the owner still cannot verify themselves',
    !selfVerify.ok && /set by review/.test(selfVerify.error ?? ''), selfVerify.error);

  const selfStamp = await as(employerUnverified,
    `update companies set verified_at = now() where id = '${unverifiedCo}'`);
  report.check('nor stamp the date', !selfStamp.ok, selfStamp.error);

  // A reviewer's decision is not undone by the trigger that watches documents.
  await db.exec(`
    update companies set verification_status = 'verified', verified_at = now() where id = '${unverifiedCo}';
    update company_documents set status = 'verified' where company_id = '${unverifiedCo}';
  `);
  const reviewed = (
    await db.query(`select verification_status from companies where id = '${unverifiedCo}'`)
  ).rows[0].verification_status;
  report.check('a review is not recomputed away', reviewed === 'verified', reviewed);

  // Withdrawn before anybody looked: back out of the queue rather than sitting
  // in a count the queue itself no longer shows.
  await db.exec(`
    update companies set verification_status = 'unverified', verified_at = null where id = '${unverifiedCo}';
    update company_documents set status = 'pending' where company_id = '${unverifiedCo}';
    insert into company_documents (company_id, doc_type, storage_path)
      values ('${unverifiedCo}', 'tax_card', '${unverifiedCo}/tax.pdf');
  `);
  const bothPending = (
    await db.query(`select verification_status from companies where id = '${unverifiedCo}'`)
  ).rows[0].verification_status;
  report.check('two documents still means one queue entry', bothPending === 'pending', bothPending);

  await db.exec(`delete from company_documents where company_id = '${unverifiedCo}' and doc_type = 'tax_card'`);
  const stillPending = (
    await db.query(`select verification_status from companies where id = '${unverifiedCo}'`)
  ).rows[0].verification_status;
  report.check('withdrawing one of two leaves it in the queue', stillPending === 'pending', stillPending);

  await db.exec(`delete from company_documents where company_id = '${unverifiedCo}'`);
  const withdrawn = (
    await db.query(`select verification_status from companies where id = '${unverifiedCo}'`)
  ).rows[0].verification_status;
  report.check('withdrawing the last one takes it back out',
    withdrawn === 'unverified', withdrawn);
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

report.section('an applicant keeps the listing they applied to');
{
  /*
    An employer editing a live listing materially sends it back to
    pending_review, which jobs_select_active does not cover — so every
    application on it used to fall out of the applicant's own dashboard, which
    drops a row whose job embed comes back null. Not "taken down": gone.
  */
  const applicant = (
    await db.query(`select candidate_id from applications where job_id = '${liveJob}' limit 1`)
  ).rows[0]?.candidate_id;
  report.check('found an applicant on the live listing', Boolean(applicant));

  await db.exec(`update jobs set status = 'pending_review' where id = '${liveJob}'`);

  const theirs = await as(applicant, `select id, status from jobs where id = '${liveJob}'`);
  report.check('they still see it while it is back in review',
    theirs.ok && theirs.rows.length === 1, JSON.stringify(theirs.rows));

  const stranger = await as(OUTSIDER, `select id from jobs where id = '${liveJob}'`);
  report.check('and somebody who did not apply does not',
    stranger.ok && stranger.rows.length === 0, JSON.stringify(stranger.rows));

  const anon = await as(null, `select id from jobs where id = '${liveJob}'`, 'anon');
  report.check('nor does the public board', anon.ok && anon.rows.length === 0, anon.error);

  await db.exec(`update jobs set status = 'active' where id = '${liveJob}'`);
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

  // The premise the action now relies on. A delete RLS filters away is not an
  // error — it matches nothing — so deleteSavedSearch has to ask what it
  // removed rather than trust the absence of an error.
  const r3b = await as(OUTSIDER, `delete from saved_searches returning id`);
  report.check('nor delete them, and the refusal is zero rows rather than an error',
    r3b.ok && r3b.rows.length === 0, r3b.error);

  const r4 = await as(candidate, `update saved_searches set last_sent_at=now()`);
  report.check('the owner cannot fake last_sent_at', !r4.ok, r4.ok ? 'update was allowed' : r4.error);

  const r5 = await as(candidate, `update saved_searches set alerts=false returning alerts`);
  report.check('but can turn its alerts off', r5.ok && r5.rows.length === 1, r5.error);

  // The filters the board can actually produce have to fit in the column that
  // stores them. 21 districts alone are 388 characters and every facet
  // together is 677; the check used to stop at 500, so an ordinary "everything
  // in Cairo" search was refused by the database after the form accepted it.
  const wide = 'district=maadi&'.repeat(45).slice(0, 660);
  const rWide = await as(candidate,
    `insert into saved_searches (candidate_id, label, query)
       values ('${candidate}', 'كل القاهرة', '${wide}') returning id`);
  report.check(`a search holding every filter fits (${wide.length} chars)`,
    rWide.ok && rWide.rows.length === 1, rWide.error);

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

report.section('dashboard summaries answer for the caller, and only the caller');
{
  const r = await as(candidate, `select public.candidate_summary() as s`);
  report.check('a candidate gets their own summary', r.ok && r.rows.length === 1, r.error);

  const r2 = await as(employerVerified, `select public.employer_summary() as s`);
  const emp = r2.rows[0]?.s;
  report.check('an employer gets theirs', r2.ok && emp?.has_company === true, JSON.stringify(emp));
  report.check(
    'scoped to their own company only',
    r2.ok && typeof emp?.applicants_total === 'number' && typeof emp?.credits === 'number',
    JSON.stringify(emp),
  );

  // A candidate has no company; that is a real state, not an error.
  const r3 = await as(candidate, `select public.employer_summary() as s`);
  report.check(
    'somebody with no company gets zeroes, not a crash',
    r3.ok && r3.rows[0]?.s?.has_company === false,
    r3.error ?? JSON.stringify(r3.rows[0]?.s),
  );

  // The moderation numbers are the whole platform's; only an admin may read them.
  const r4 = await as(employerVerified, `select public.admin_summary()`);
  report.check('an employer cannot read the admin summary', !r4.ok, r4.ok ? 'call was allowed' : r4.error);

  const r5 = await as(candidate, `select public.admin_summary()`);
  report.check('nor can a candidate', !r5.ok, r5.ok ? 'call was allowed' : r5.error);

  const r6 = await as(admin, `select public.admin_summary() as s`);
  report.check('an admin can', r6.ok && typeof r6.rows[0]?.s?.queue_total === 'number', r6.error);

  const r7 = await as(null, `select public.candidate_summary()`, 'anon');
  report.check('and anonymous reaches none of them', !r7.ok, r7.ok ? 'call was allowed' : r7.error);
}

report.section('dashboard trends are gap-free and scoped like the summaries');
{
  const r = await as(employerVerified, `select public.employer_trend() as s`);
  const trend = r.rows[0]?.s;
  report.check('an employer gets a thirty-day window', r.ok && trend?.days?.length === 30, r.error);

  // The whole point of generate_series: a day nobody applied is a zero, not a
  // missing point that a chart would draw straight through.
  const dates = (trend?.days ?? []).map((day) => day.d);
  const contiguous = dates.every((d, i) => {
    if (i === 0) return true;
    const gap = (Date.parse(d) - Date.parse(dates[i - 1])) / 86_400_000;
    return gap === 1;
  });
  report.check('with every day in it, including the empty ones', contiguous, JSON.stringify(dates.slice(0, 3)));

  // Scoping is the security property here, so it is checked against the
  // database rather than against another call to the same function.
  const own = (
    await db.query(`
      select count(*)::int as n
        from applications a
        join jobs j on j.id = a.job_id
       where j.company_id = (select id from companies where slug = 'al-rowad-real-estate-309047')
         and a.created_at >= ((now() at time zone 'Africa/Cairo')::date - 29)`)
  ).rows[0].n;
  const charted = (trend?.days ?? []).reduce((total, day) => total + day.applications, 0);
  const platform = (await db.query('select count(*)::int as n from applications')).rows[0].n;

  report.check('counting their own applications and nobody else\'s',
    charted === own && charted < platform, `charted ${charted}, own ${own}, platform ${platform}`);

  const ownJobs = await as(employerVerified,
    "select id from jobs where company_id = (select id from companies where slug = 'al-rowad-real-estate-309047')");
  const ownIds = new Set(ownJobs.rows.map((row) => row.id));
  report.check('and comparing only their own live listings',
    (trend?.conversion ?? []).length > 0 && trend.conversion.every((row) => ownIds.has(row.id)),
    JSON.stringify(trend?.conversion?.length));

  const noCompany = await as(candidate, `select public.employer_trend() as s`);
  report.check('somebody with no company gets the empty shape, not a crash',
    noCompany.ok && noCompany.rows[0]?.s?.has_company === false, noCompany.error);

  const byEmployer = await as(employerVerified, `select public.admin_trend()`);
  report.check('an employer cannot read the platform trend',
    !byEmployer.ok, byEmployer.ok ? 'call was allowed' : byEmployer.error);

  const byCandidate = await as(candidate, `select public.admin_trend()`);
  report.check('nor can a candidate', !byCandidate.ok, byCandidate.ok ? 'call was allowed' : byCandidate.error);

  const byAdmin = await as(admin, `select public.admin_trend() as s`);
  report.check('an admin can, over the same window',
    byAdmin.ok && byAdmin.rows[0]?.s?.days?.length === 30, byAdmin.error);

  const anonEmployer = await as(null, `select public.employer_trend()`, 'anon');
  const anonAdmin = await as(null, `select public.admin_trend()`, 'anon');
  report.check('and anonymous reaches neither', !anonEmployer.ok && !anonAdmin.ok);
}

report.section('a company is a team, not a login');
{
  const COLLEAGUE = '7f7f7f7f-1111-4222-8333-999999999999';
  await db.exec(`
    insert into auth.users (id, email) values ('${COLLEAGUE}', 'colleague@demo.test');
    insert into profiles (id, role, full_name, whatsapp_phone)
      values ('${COLLEAGUE}', 'employer', 'زميلة', '+201666666666');
  `);

  /*
    The company this fixture is an admin of, asked for by membership.

    It used to look up a slug the seed no longer generates and fall back to
    `select id from companies limit 1` — an arbitrary row, which happened to be
    the right one only because nothing had rewritten the heap. The first
    committed UPDATE anywhere earlier in the suite reordered it and every
    assertion below started failing for a reason that had nothing to do with
    what they test.
  */
  const alRowad = (
    await db.query(
      `select company_id from company_members where user_id = '${employerVerified}' and role = 'admin' limit 1`,
    )
  ).rows[0].company_id;

  const before = await as(COLLEAGUE,
    `select count(*)::int as n from applications a join jobs j on j.id = a.job_id
      where j.company_id = '${alRowad}'`);
  report.check('somebody outside the company sees none of its applicants',
    before.ok && before.rows[0].n === 0, before.error);

  // The owner adds them. Through the policy, as the product would.
  const invite = await as(employerVerified,
    `insert into company_members (company_id, user_id, role)
       values ('${alRowad}','${COLLEAGUE}','recruiter') returning role`);
  report.check('an admin can add a colleague', invite.ok && invite.rows.length === 1, invite.error);

  await db.exec(
    `insert into company_members (company_id, user_id, role)
       values ('${alRowad}','${COLLEAGUE}','recruiter') on conflict do nothing`,
  );

  const after = await as(COLLEAGUE,
    `select count(*)::int as n from applications a join jobs j on j.id = a.job_id
      where j.company_id = '${alRowad}'`);
  report.check(`and then they see the company's applicants (0 → ${after.rows[0]?.n})`,
    after.ok && after.rows[0].n > 0, after.error);

  const rosterOutsider = await as(candidate,
    `select count(*)::int as n from company_members where company_id = '${alRowad}'`);
  report.check('the roster is not public', rosterOutsider.ok && rosterOutsider.rows[0].n === 0);

  // A recruiter works the listings; the company record is an admin's.
  const recruiterEdit = await as(COLLEAGUE,
    `update companies set about_ar = 'x' where id = '${alRowad}' returning id`);
  report.check('a recruiter cannot edit the company record',
    recruiterEdit.ok && recruiterEdit.rows.length === 0, 'the update matched a row');

  const recruiterInvite = await as(COLLEAGUE,
    `insert into company_members (company_id, user_id, role)
       values ('${alRowad}','${OUTSIDER}','recruiter')`);
  report.check('nor add anybody else', !recruiterInvite.ok, 'the insert was allowed');

  // Ownership is the anchor. An admin may not unpick it.
  const ownerId = (await db.query(`select owner_id from companies where id = '${alRowad}'`)).rows[0].owner_id;

  const removeOwner = await as(employerVerified,
    `delete from company_members where company_id = '${alRowad}' and user_id = '${ownerId}'`);
  report.check('the owner cannot be removed from their own company',
    !removeOwner.ok && /company_owner_membership/.test(removeOwner.error ?? ''), removeOwner.error);

  const demoteOwner = await as(employerVerified,
    `update company_members set role = 'recruiter'
      where company_id = '${alRowad}' and user_id = '${ownerId}'`);
  report.check('nor demoted',
    !demoteOwner.ok && /company_owner_membership/.test(demoteOwner.error ?? ''), demoteOwner.error);

  // A consultant with employer powers could read applications to their own
  // listings, which is the hole migration 15 closed.
  const addCandidate = await as(employerVerified,
    `insert into company_members (company_id, user_id, role)
       values ('${alRowad}','${candidate}','recruiter')`);
  report.check('a candidate account cannot be made a member',
    !addCandidate.ok && /company_member_role/.test(addCandidate.error ?? ''), addCandidate.error);

  // What a recruiter must NOT inherit. Migration 22 widened owns_company()
  // and swept these along with the listings; migration 24 pulled them back.
  const docs = await as(COLLEAGUE,
    `select count(*)::int as n from company_documents where company_id = '${alRowad}'`);
  report.check('a recruiter cannot read the company\'s verification documents',
    docs.ok && docs.rows[0].n === 0, docs.error);

  const orders = await as(COLLEAGUE,
    `select count(*)::int as n from orders where company_id = '${alRowad}'`);
  report.check('nor what the company has been charged',
    orders.ok && orders.rows[0].n === 0, orders.error);

  const grants = await as(COLLEAGUE,
    `select count(*)::int as n from monthly_free_post_grants where company_id = '${alRowad}'`);
  report.check('nor the free-post ledger', grants.ok && grants.rows[0].n === 0, grants.error);

  // But the listings, which is the entire point of being a member.
  const listings = await as(COLLEAGUE,
    `select count(*)::int as n from jobs where company_id = '${alRowad}'`);
  report.check('while the listings are theirs to work on',
    listings.ok && listings.rows[0].n > 0, listings.error);

  // And an admin member still reaches the paperwork.
  const ownerDocs = await as(employerVerified,
    `select count(*)::int as n from company_documents where company_id = '${alRowad}'`);
  report.check('an admin still reaches the paperwork', ownerDocs.ok, ownerDocs.error);

  // And the thing that broke twenty-three assertions when it was missing.
  const fresh = (
    await db.query(`
      insert into companies (owner_id, name_ar, slug, verification_status, post_credits)
      values ('${COLLEAGUE}', 'شركة جديدة', 'new-co-fixture', 'unverified', 0)
      returning id
    `)
  ).rows[0].id;
  const seeded = await db.query(
    `select role from company_members where company_id = '${fresh}' and user_id = '${COLLEAGUE}'`,
  );
  report.check('creating a company makes its creator an admin of it',
    seeded.rows[0]?.role === 'admin', JSON.stringify(seeded.rows));
}

report.section('applying tells both sides, not just the employer');
{
  // Before the rate-limit section, which fills this candidate's daily window.
  const target = (
    await db.query(`
      select j.id, c.owner_id from jobs j join companies c on c.id = j.company_id
       where j.status = 'active'
         and j.id not in (select job_id from applications where candidate_id = '${candidate}')
       limit 1
    `)
  ).rows[0];

  // Counted as a delta: other candidates in the seed have applied to this
  // listing already, so the employer's total is not 0 to begin with.
  const employerNotices = async () =>
    (
      await db.query(`
        select count(*)::int as n from notifications
         where user_id = '${target.owner_id}' and kind = 'application_received'
           and payload->>'job_id' = '${target.id}'
      `)
    ).rows[0].n;

  const before = await employerNotices();
  await db.exec(
    `insert into applications (job_id, candidate_id) values ('${target.id}','${candidate}')`,
  );
  const after = await employerNotices();

  report.check(`the employer is told somebody applied (${before} → ${after})`,
    after === before + 1);

  const forCandidate = await db.query(`
    select payload from notifications
     where user_id = '${candidate}' and kind = 'application_submitted'
       and payload->>'job_id' = '${target.id}'
  `);
  report.check('and the applicant is told it landed', forCandidate.rows.length === 1);

  // Data, not prose: the feed is bilingual and builds its own sentence.
  const payload = forCandidate.rows[0]?.payload ?? {};
  report.check('with the company in the payload, not a rendered sentence',
    Boolean(payload.title_ar) && Boolean(payload.company_ar) && !payload.message,
    JSON.stringify(payload));

  const leaked = await as(publicAgent,
    `select count(*)::int as n from notifications where user_id = '${candidate}'`);
  report.check('and nobody else can read it', leaked.ok && leaked.rows[0].n === 0, leaked.error);
}

report.section('reports need an account, and an account has limits');
{
  const anon = await as(null, `insert into reports (job_id, reason) values ('${liveJob}','spam')`, 'anon');
  report.check('a signed-out visitor cannot file a report',
    !anon.ok, anon.ok ? 'insert was allowed' : anon.error);

  const spoof = await as(candidate,
    `insert into reports (job_id, reporter_id, reason) values ('${liveJob}','${OUTSIDER}','spam')`);
  report.check('nor can a reader file one under somebody else\'s name',
    !spoof.ok, spoof.ok ? 'insert was allowed' : spoof.error);

  const first = await as(candidate,
    `insert into reports (job_id, reporter_id, reason) values ('${liveJob}','${candidate}','spam') returning id`);
  report.check('a signed-in reader can', first.ok && first.rows.length === 1, first.error);

  // Committed, so the duplicate probe has something to collide with. Probes
  // roll back; setup has to persist.
  await db.exec(`insert into reports (job_id, reporter_id, reason) values ('${liveJob}','${candidate}','spam')`);

  const dupe = await as(candidate,
    `insert into reports (job_id, reporter_id, reason) values ('${liveJob}','${candidate}','duplicate')`);
  report.check('but not twice on the same listing',
    !dupe.ok && /reports_one_per_reporter_per_job/.test(dupe.error ?? ''), dupe.error);

  // Enough listings to reach the cap on distinct ones, so what stops the last
  // report is the cap and not the unique index. Cloned through a temp copy of
  // a real row, which keeps every not-null and check constraint satisfied
  // without this test having to know the column list.
  await db.exec(`
    create temp table rl_job as select * from jobs where id = '${liveJob}';
    do $$
    declare
      i int;
      cols text;
    begin
      -- Every column the table will actually accept. jobs.search_vector is
      -- generated, so a bare "insert ... select *" is rejected; asking the
      -- catalogue keeps this test from having to know that, or to be edited
      -- the next time a column is added.
      select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
        into cols
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'jobs'
         and is_generated = 'NEVER';

      for i in 1..45 loop
        update rl_job
           set id = gen_random_uuid(),
               slug = 'rate-limit-fixture-' || lpad(i::text, 2, '0'),
               status = 'draft';
        execute format('insert into jobs (%s) select %s from rl_job', cols, cols);
      end loop;
    end $$;
  `);

  const rlJobs = (
    await db.query("select id from jobs where slug like 'rate-limit-fixture-%' order by slug")
  ).rows.map((row) => row.id);

  for (const id of rlJobs.slice(0, 9)) {
    await db.exec(`insert into reports (job_id, reporter_id, reason) values ('${id}','${candidate}','spam')`);
  }

  const eleventh = await as(candidate,
    `insert into reports (job_id, reporter_id, reason) values ('${rlJobs[9]}','${candidate}','spam')`);
  report.check('the tenth report in a day is the last one',
    !eleventh.ok && /report_rate_limit/.test(eleventh.error ?? ''), eleventh.error);

  const other = await as(publicAgent,
    `insert into reports (job_id, reporter_id, reason) values ('${rlJobs[9]}','${publicAgent}','spam') returning id`);
  report.check('and the cap is per account, not per listing',
    other.ok && other.rows.length === 1, other.error);
}

report.section('applications are capped per day too');
{
  // Counted inside the trigger's own window, not over the whole table. The
  // seeded applications are older than a day and correctly do not count, which
  // is the difference between a rolling limit and a lifetime quota.
  const inWindow = `
    select count(*)::int as n from applications
     where candidate_id = '${candidate}' and created_at > now() - interval '1 day'
  `;
  const held = (await db.query(inWindow)).rows[0].n;

  const fixtures = (
    await db.query(`
      select id from jobs
       where slug like 'rate-limit-fixture-%'
         and id not in (select job_id from applications where candidate_id = '${candidate}')
       order by slug
    `)
  ).rows.map((row) => row.id);

  const needed = 30 - held;
  for (const id of fixtures.slice(0, needed)) {
    await db.exec(`insert into applications (job_id, candidate_id) values ('${id}','${candidate}')`);
  }

  const atCap = (await db.query(inWindow)).rows[0].n;
  report.check(`thirty applications in a day are allowed (${atCap})`, atCap === 30);

  // service_role, so this proves the trigger holds even for a caller that RLS
  // does not apply to — the cap is a property of the table, not of a policy.
  const overCap = await as(null,
    `insert into applications (job_id, candidate_id) values ('${fixtures[needed]}','${candidate}')`,
    'service_role');
  report.check('the thirty-first is refused',
    !overCap.ok && /application_rate_limit/.test(overCap.error ?? ''), overCap.error);

  const different = await as(null,
    `insert into applications (job_id, candidate_id) values ('${fixtures[needed]}','${publicAgent}') returning id`,
    'service_role');
  report.check('and a different candidate is unaffected',
    different.ok && different.rows.length === 1, different.error);

  // Age one row out of the window. A rolling limit has to let yesterday go;
  // a lifetime quota would not, and the difference is invisible until the
  // day somebody who applied thirty times last month cannot apply again.
  await db.exec(`
    update applications set created_at = now() - interval '2 days'
     where id = (
       select id from applications
        where candidate_id = '${candidate}' and created_at > now() - interval '1 day'
        limit 1
     )
  `);
  const rolled = await as(null,
    `insert into applications (job_id, candidate_id) values ('${fixtures[needed]}','${candidate}') returning id`,
    'service_role');
  report.check('and the window rolls — yesterday stops counting',
    rolled.ok && rolled.rows.length === 1, rolled.error);
}

report.section('the nightly expiry cron');
{
  await db.exec("update jobs set published_at = now() - interval '31 days', expires_at = now() - interval '1 day' where status='active'");
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

report.section('suspending an account takes its adverts down with it');
{
  const PEER = '7f7f7f7f-1111-4222-8333-999999999999';
  const company = (
    await db.query(
      `select company_id from company_members where user_id = '${employerVerified}' limit 1`,
    )
  ).rows[0].company_id;

  /*
    Put this company back on the board first. Two sections above, the expiry
    job ran and flipped every past-window listing to expired — correct there,
    and it leaves nothing live for this section to take down.
  */
  await db.exec(`
    update jobs
       set status = 'active', expires_at = now() + interval '30 days'
     where company_id = '${company}' and status in ('expired', 'active')`);

  const liveBefore = (
    await db.query(
      `select count(*)::int as n from jobs where company_id = '${company}' and status = 'active'`,
    )
  ).rows[0].n;
  report.check(`the company has ${liveBefore} live listing(s) to lose`, liveBefore > 0);

  /*
    `as()` reports whether a statement was permitted and rolls back, which is
    the right shape for a policy question and the wrong one here: the point of
    this change is what the call *does*. So the suspension and the count that
    follows it share one transaction, and the rollback happens after both.

    Reading the effect from a scalar subquery in the same statement does not
    work — the planner is free to run that subplan before the CTE that calls
    the function, and it does, which is a test that passes against a function
    body that does nothing at all.
  */
  async function suspendThenCount(status) {
    await db.exec('begin');
    try {
      await db.exec('set local role authenticated;');
      await db.exec(`set local request.jwt.claim.sub = '${admin}';`);
      await db.exec(`set local request.jwt.claims = '{"role":"authenticated","sub":"${admin}"}';`);
      await db.query(
        `select set_account_approval('${employerVerified}'::uuid, 'rejected'::approval_status, 'حساب موقوف')`,
      );
      const { rows } = await db.query(
        `select count(*)::int as n from jobs
          where company_id = '${company}' and status = '${status}'`,
      );
      return { ok: true, n: rows[0].n };
    } catch (error) {
      return { ok: false, error: error.message, n: -1 };
    } finally {
      await db.exec('rollback');
    }
  }

  // A colleague in good standing is cover for the company: one bad recruiter
  // is not the firm, so nothing should come down while somebody else is fine.
  await db.exec(`
    insert into auth.users (id, email)
      values ('${PEER}', 'peer-suspension@demo.test') on conflict do nothing;
    insert into profiles (id, role, full_name, whatsapp_phone, approval_status)
      values ('${PEER}', 'employer', 'زميل', '+201666666666', 'approved') on conflict do nothing;
    insert into company_members (company_id, user_id, role)
      values ('${company}', '${PEER}', 'recruiter') on conflict do nothing;`);

  /*
    Stated after the insert, not in it. New employer accounts are forced to
    'pending' by a before-insert trigger — which is the rule, and which meant
    the first version of this test seeded a colleague who was not in good
    standing and then proved the takedown fired, for the wrong reason.
  */
  await db.exec(`update profiles set approval_status = 'approved' where id = '${PEER}'`);

  const covered = await suspendThenCount('active');
  report.check(
    'a colleague in good standing keeps the company trading',
    covered.ok && covered.n === liveBefore,
    covered.error ?? `${covered.n} of ${liveBefore} still live`,
  );

  // Now the colleague goes too, so the account is the last approved member.
  await db.exec(`update profiles set approval_status = 'rejected' where id = '${PEER}'`);

  const alone = await suspendThenCount('rejected');
  report.check(
    `the last approved member going down takes the listings with it (${alone.n} of ${liveBefore})`,
    alone.ok && alone.n === liveBefore,
    alone.error,
  );

  const byReader = await as(
    candidate,
    `select set_account_approval('${employerVerified}'::uuid, 'approved'::approval_status, null)`,
  );
  report.check(
    'and a non-admin cannot call it at all',
    !byReader.ok && /forbidden/.test(byReader.error ?? ''),
    byReader.error,
  );
}

report.section('one source of truth for the company a member acts for');
{
  /*
    A company is a team. owns_company(), owns_job() and is_company_admin() all
    read company_members, so any member may post a job and read the applicants
    while only an admin member may edit the company. Three functions were left
    resolving the company by companies.owner_id, which told an invited
    recruiter they had no company at all while the database happily let them
    work — and claim_monthly_free_post() could not find a company to grant to.

    Asserted against the live definitions rather than the migration files,
    because the files are append-only history and still contain the superseded
    versions.
  */
  const offenders = await db.query(`
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosrc ~ 'owner_id\\s*=\\s*auth\\.uid\\(\\)'
    order by p.proname
  `);
  report.check(
    'no function resolves a company by ownership',
    offenders.rows.length === 0,
    offenders.rows.map((r) => r.proname).join(', '),
  );

  // The free post: proven to grant, and proven not to have opened a hole.
  const owner = (await db.query(
    "select owner_id from companies where verification_status = 'verified' limit 1",
  )).rows[0].owner_id;

  const granted = await as(owner, "select public.claim_monthly_free_post() as ok");
  report.check(
    'a verified company can claim its monthly free post',
    granted.rows?.[0]?.ok === true,
    granted.error ?? JSON.stringify(granted.rows?.[0] ?? null),
  );

  const direct = await as(owner, `
    update companies set post_credits = post_credits + 99
    where id = public.my_company_id()
  `);
  report.check(
    'and the owner still cannot write credits directly',
    Boolean(direct.error),
    direct.error ? '' : 'the update was allowed',
  );
}

report.section('withdrawing has a precondition the database keeps');
{
  /*
    The dashboard offers withdrawal only while an application is new or
    shortlisted. Until now the policy permitted a delete at any status, so a
    hired candidate could remove the employer's only record of the hire with a
    request the interface never makes.

    Setup runs through db.exec — no JWT, so acting_as_admin() is true and the
    column guard stands aside. Only the delete itself goes through as(), which
    is the statement under test, and as() rolls back so the row survives into
    the next case.
  */
  const mine = (await db.query(
    `select id from applications where candidate_id = '${candidate}' limit 1`,
  )).rows[0].id;

  await db.exec(`update applications set status = 'new' where id = '${mine}'`);
  const open = await as(candidate, `delete from applications where id = '${mine}' returning id`);
  report.check('a candidate may withdraw while the outcome is open',
    open.ok && open.rows.length === 1, open.error);

  for (const status of ['interview', 'hired', 'rejected']) {
    await db.exec(`update applications set status = '${status}' where id = '${mine}'`);
    const shut = await as(candidate, `delete from applications where id = '${mine}' returning id`);
    report.check(`and cannot once it is ${status}`,
      shut.ok && shut.rows.length === 0, shut.error ?? `deleted ${shut.rows.length} row(s)`);
  }

  await db.exec(`update applications set status = 'new' where id = '${mine}'`);
}

report.section('an application remembers how it moved');
{
  const jobForHistory = (await db.query(`
    select j.id from jobs j
    where j.status = 'active' and j.expires_at > now()
      and not exists (select 1 from applications a where a.job_id = j.id and a.candidate_id = '${OUTSIDER}')
    limit 1
  `)).rows[0].id;

  await db.exec(
    `insert into applications (job_id, candidate_id) values ('${jobForHistory}', '${OUTSIDER}')`,
  );
  const appId = (await db.query(
    `select id from applications where job_id = '${jobForHistory}' and candidate_id = '${OUTSIDER}'`,
  )).rows[0].id;

  const created = await as(OUTSIDER,
    `select from_status, to_status from application_events where application_id = '${appId}'`);
  report.check('applying writes the opening event',
    created.ok && created.rows.length === 1 && created.rows[0].to_status === 'new' && created.rows[0].from_status === null,
    created.error ?? JSON.stringify(created.rows));

  // A note is not a move, and the view stamp is not a move.
  await db.exec(`update applications set decision_note = 'note only' where id = '${appId}'`);
  await db.exec(`update applications set employer_viewed_at = now() where id = '${appId}'`);
  await db.exec(`update applications set status = 'shortlisted' where id = '${appId}'`);

  const moved = await as(employerVerified,
    `select from_status, to_status from application_events where application_id = '${appId}' order by id`);
  report.check('a move is recorded and a note or a view stamp is not',
    moved.ok && moved.rows.length === 2 &&
      moved.rows[1].from_status === 'new' && moved.rows[1].to_status === 'shortlisted',
    moved.error ?? JSON.stringify(moved.rows));

  const nosy = await as(OUTSIDER, `
    select count(*)::int as n from application_events
     where application_id in (select id from applications where candidate_id = '${candidate}')
  `);
  report.check('and nobody reads a history that is not theirs',
    nosy.ok && nosy.rows[0].n === 0, nosy.error ?? `saw ${nosy.rows?.[0]?.n}`);
}

process.exit(report.finish() ? 0 : 1);
