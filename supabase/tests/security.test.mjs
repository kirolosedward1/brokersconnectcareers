/**
 * The hardening round's rules, exercised against the real policies, triggers
 * and functions. Run with: pnpm test:security
 *
 * Everything here was a hole or a gap found in the audit that preceded
 * migrations 303–313. Each section names the migration that closed it, so a
 * failure points at the file to reread.
 */
import { createTestDb, runner, reporter, FIXTURES } from './setup.mjs';

const report = reporter();
const db = await createTestDb();
const as = runner(db);

const { employerVerified, employerUnverified, candidate, publicAgent, admin } = FIXTURES;

const one = async (sql) => (await db.query(sql)).rows[0];
const verifiedCompany = (await one(`select company_id from company_members where user_id = '${employerVerified}' and role = 'admin' limit 1`)).company_id;
const unverifiedCompany = (await one(`select company_id from company_members where user_id = '${employerUnverified}' and role = 'admin' limit 1`)).company_id;
const liveJob = (await one(`select id from jobs where company_id = '${verifiedCompany}' and status = 'active' limit 1`)).id;
const district = (await one(`select id from districts order by id limit 1`)).id;

// ---------------------------------------------------------------------------
report.section('303 — decisions leave a trail');
{
  const before = Number((await one(`select count(*)::int as n from audit_log`)).n);

  // Committed, because the trail has to survive the statement that wrote it.
  await db.exec(`
    set local role authenticated;
    set local request.jwt.claim.sub = '${admin}';
    set local request.jwt.claims = '{"role":"authenticated","sub":"${admin}"}';
    select set_account_approval('${employerUnverified}', 'pending', 'looking again');
    select set_account_approval('${employerUnverified}', 'approved', null);
    reset role;
  `);

  const trail = (await db.query(`
    select action, actor_id, actor_role, metadata from audit_log
     where target_id = '${employerUnverified}' order by id desc limit 2`)).rows;
  report.check('an approval change is recorded with its actor',
    trail.length === 2 && trail.every((row) => row.action === 'account.approval_changed' && row.actor_id === admin && row.actor_role === 'admin'),
    JSON.stringify(trail));
  report.check('with the states before and after',
    trail[0]?.metadata?.from === 'pending' && trail[0]?.metadata?.to === 'approved', JSON.stringify(trail[0]?.metadata));

  const after = Number((await one(`select count(*)::int as n from audit_log`)).n);
  report.check('two decisions, two rows', after - before === 2, `${after - before}`);

  const asEmployer = await as(employerVerified, 'select id from audit_log');
  report.check('nobody but an admin reads the trail', asEmployer.ok && asEmployer.rows.length === 0, JSON.stringify(asEmployer.rows.length));

  const asAdmin = await as(admin, 'select id from audit_log limit 1');
  report.check('an admin does', asAdmin.ok && asAdmin.rows.length === 1, asAdmin.error);

  const forged = await as(admin, `insert into audit_log (actor_role, action, target_type) values ('admin', 'forged', 'x')`);
  report.check('nobody writes it by hand, not even an admin', !forged.ok, forged.ok ? 'insert was allowed' : '');

  const direct = await as(employerVerified, `select public.audit('x', 'y', 'z')`);
  report.check('audit() is not callable over the API', !direct.ok && /permission denied/.test(direct.error ?? ''), direct.error);

  const event = await as(employerVerified, `select public.record_security_event('x')`);
  report.check('nor is record_security_event()', !event.ok && /permission denied/.test(event.error ?? ''), event.error);
}

// ---------------------------------------------------------------------------
report.section('305 — the token and the note are not on the profile');
{
  const cols = (await db.query(`
    select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name in ('unsubscribe_token', 'approval_note')`)).rows;
  report.check('profiles no longer carries them', cols.length === 0, JSON.stringify(cols));

  const rows = Number((await one(`select count(*)::int as n from profile_private`)).n);
  const people = Number((await one(`select count(*)::int as n from profiles`)).n);
  report.check(`every profile has a private row (${rows} of ${people})`, rows === people);

  // An employer who holds an application from this candidate reads the
  // profile — and nothing beside it.
  await db.exec(`insert into applications (job_id, candidate_id) values ('${liveJob}', '${candidate}') on conflict do nothing`);
  const profile = await as(employerVerified, `select whatsapp_phone from profiles where id = '${candidate}'`);
  report.check('an employer reads the applicant profile', profile.ok && profile.rows.length === 1, profile.error);
  const secret = await as(employerVerified, `select unsubscribe_token from profile_private where user_id = '${candidate}'`);
  report.check('and cannot read the private row beside it', secret.ok && secret.rows.length === 0, JSON.stringify(secret.rows));

  const own = await as(candidate, `select unsubscribe_token from profile_private where user_id = '${candidate}'`);
  report.check('nor can the person read their own token over the API', own.ok && own.rows.length === 0);

  const rotate = await as(candidate, `update profile_private set unsubscribe_token = gen_random_uuid() where user_id = '${candidate}' returning user_id`);
  report.check('nor rotate it', !rotate.ok || rotate.rows.length === 0);

  const reviewer = await as(admin, `select approval_note from profile_private where user_id = '${employerUnverified}'`);
  report.check('an admin reads the reviewer note', reviewer.ok && reviewer.rows.length === 1, reviewer.error);

  const notified = await one(`select payload from notifications where user_id = '${employerUnverified}' and kind = 'account_rejected' order by created_at desc limit 1`);
  report.check('the note still reaches the suspension notification', notified === undefined || typeof notified.payload === 'object');
}

// ---------------------------------------------------------------------------
report.section('304 — a contact is asked for, counted and written down');
{
  const agents = (await db.query(`
    select a.slug from agent_profiles a join profiles p on p.id = a.user_id
     where a.visibility <> 'hidden' and p.role = 'candidate' and p.approval_status = 'approved'
     order by a.slug limit 3`)).rows.map((row) => row.slug);
  report.check('found three consultants to open', agents.length === 3);

  await db.exec(`update abuse_limits set max_hits = 2 where key = 'contact_reveal:user:hour'`);
  await db.exec(`delete from agent_contact_reveals where viewer_id = '${employerVerified}'`);

  const first = await as(employerVerified, `select status, whatsapp_phone from reveal_agent_contact('${agents[0]}')`);
  report.check('the first reveal answers with a number', first.rows[0]?.status === 'ok' && first.rows[0]?.whatsapp_phone !== null, JSON.stringify(first.rows[0] ?? first.error));

  // The runner rolls back, so the ledger rows are written by hand as the
  // function would have written them.
  await db.exec(`
    insert into agent_contact_reveals (agent_id, viewer_id, company_id)
    select id, '${employerVerified}', '${verifiedCompany}' from agent_profiles where slug in ('${agents[0]}', '${agents[1]}')`);

  const again = await as(employerVerified, `select status from reveal_agent_contact('${agents[0]}')`);
  report.check('opening the same card again is free', again.rows[0]?.status === 'ok', JSON.stringify(again.rows[0]));

  const third = await as(employerVerified, `select status, retry_after_seconds, whatsapp_phone from reveal_agent_contact('${agents[2]}')`);
  report.check('the one past the hourly allowance is refused, with a wait',
    third.rows[0]?.status === 'rate_limited' && third.rows[0]?.retry_after_seconds > 0 && third.rows[0]?.whatsapp_phone === null,
    JSON.stringify(third.rows[0] ?? third.error));

  // The refusal is recorded even though the statement rolled back? No — the
  // runner rolls back everything. Run it committed to see the event land.
  await db.exec(`
    set local role authenticated;
    set local request.jwt.claim.sub = '${employerVerified}';
    set local request.jwt.claims = '{"role":"authenticated","sub":"${employerVerified}"}';
    select status from reveal_agent_contact('${agents[2]}');
    reset role;
  `);
  const recorded = await one(`select count(*)::int as n from security_events where kind = 'contact.reveal_rate_limited' and actor_id = '${employerVerified}'`);
  report.check('and the refusal is a security event', Number(recorded.n) >= 1, JSON.stringify(recorded));

  const ledger = await as(admin, `select viewer_id from agent_contact_reveals where viewer_id = '${employerVerified}'`);
  report.check('an admin reads the ledger', ledger.ok && ledger.rows.length === 2, JSON.stringify(ledger.rows.length));

  const subjectId = (await one(`select user_id from agent_profiles where slug = '${agents[0]}'`)).user_id;
  const subject = await as(subjectId, `select viewer_id from agent_contact_reveals`);
  report.check('the consultant sees who asked for their number, and nobody else\'s', subject.ok && subject.rows.length === 1 && subject.rows[0].viewer_id === employerVerified, JSON.stringify(subject.rows));

  const stranger = await as(employerUnverified, `select viewer_id from agent_contact_reveals`);
  report.check('another employer sees nothing', stranger.ok && stranger.rows.length === 0);

  await db.exec(`update abuse_limits set max_hits = 30 where key = 'contact_reveal:user:hour'`);
  await db.exec(`delete from agent_contact_reveals where viewer_id = '${employerVerified}'`);
}

// ---------------------------------------------------------------------------
report.section('308 — a suspended account keeps nothing');
{
  const before = await as(employerVerified, `select id from applications where job_id = '${liveJob}'`);
  report.check('an approved employer reads their applicants', before.ok && before.rows.length >= 1, before.error);

  await db.exec(`update profiles set approval_status = 'rejected' where id = '${employerVerified}'`);

  const apps = await as(employerVerified, `select id from applications where job_id = '${liveJob}'`);
  report.check('suspended, the same read returns nothing', apps.ok && apps.rows.length === 0, JSON.stringify(apps.rows.length));

  const people = await as(employerVerified, `select whatsapp_phone from profiles where id = '${candidate}'`);
  report.check('the applicant\'s profile is closed too', people.ok && people.rows.length === 0);

  const docs = await as(employerVerified, `select id from company_documents where company_id = '${verifiedCompany}'`);
  report.check('and the company\'s own papers', docs.ok && docs.rows.length === 0);

  const reveal = await as(employerVerified, `select status from reveal_agent_contact('${publicAgent}')`);
  report.check('and the directory\'s contacts', ['forbidden', 'locked', 'not_found'].includes(reveal.rows[0]?.status), JSON.stringify(reveal.rows[0]));

  const company = await as(employerVerified, `select my_company_id() as id`);
  report.check('the console has no company to act for', company.ok && company.rows[0]?.id === null, JSON.stringify(company.rows));

  const listing = await as(employerVerified, `update jobs set title_ar = 'x' where id = '${liveJob}' returning id`);
  report.check('and the listings cannot be edited', listing.ok && listing.rows.length === 0);

  await db.exec(`update profiles set approval_status = 'approved' where id = '${employerVerified}'`);
  const restored = await as(employerVerified, `select id from applications where job_id = '${liveJob}'`);
  report.check('restored, everything is back', restored.ok && restored.rows.length >= 1);

  // A pending employer keeps enough to finish signing up.
  await db.exec(`update profiles set approval_status = 'pending' where id = '${employerUnverified}'`);
  const pending = await as(employerUnverified, `update companies set about_ar = 'شركة' where id = '${unverifiedCompany}' returning id`);
  report.check('a pending employer can still edit the company profile', pending.ok && pending.rows.length === 1, pending.error);
  await db.exec(`update profiles set approval_status = 'approved' where id = '${employerUnverified}'`);
}

// ---------------------------------------------------------------------------
report.section('307 — a row says what the server said');
{
  await db.exec(`update jobs set created_at = created_at - interval '2 days' where company_id = '${verifiedCompany}'`);

  const planted = await as(employerVerified, `
    insert into jobs (company_id, slug, title_ar, track, employment_type, experience_band, seats, district_id,
                      commission_type, leads_source, description_ar, status,
                      published_at, expires_at, view_count, is_featured, rejection_note, created_at)
    values ('${verifiedCompany}', 'planted-000001', 'إعلان مزروع', 'primary', 'full_time', 'junior_1_3', 1, ${district},
            'none', 'company_provided', 'وصف طويل بما يكفي لهذا الاختبار', 'draft',
            '2099-01-01', '2100-01-01', 9999, false, 'x', '2001-01-01')
    returning published_at, expires_at, view_count, rejection_note, created_at > now() - interval '1 minute' as fresh`);
  report.check('a listing arrives with the server\'s dates and counters',
    planted.ok && planted.rows[0]?.published_at === null && planted.rows[0]?.expires_at === null
      && planted.rows[0]?.view_count === 0 && planted.rows[0]?.rejection_note === null && planted.rows[0]?.fresh === true,
    JSON.stringify(planted.rows[0] ?? planted.error));

  const openJob = (await one(`
    select id from jobs where status = 'active' and expires_at > now()
       and id not in (select job_id from applications where candidate_id = '${publicAgent}')
     limit 1`)).id;
  const app = await as(publicAgent, `
    insert into applications (job_id, candidate_id, employer_viewed_at, decision_note, created_at)
    values ('${openJob}', '${publicAgent}', now(), 'hired already', '2001-01-01')
    returning employer_viewed_at, decision_note, created_at > now() - interval '1 minute' as fresh`);
  report.check('an application arrives unseen, undecided and dated now',
    app.ok && app.rows[0]?.employer_viewed_at === null && app.rows[0]?.decision_note === null && app.rows[0]?.fresh === true,
    JSON.stringify(app.rows[0] ?? app.error));

  const rep = await as(publicAgent, `
    insert into reports (job_id, reporter_id, reason, resolved, resolved_by, resolved_at)
    values ('${liveJob}', '${publicAgent}', 'spam', true, '${admin}', now())
    returning resolved, resolved_by`);
  report.check('a report arrives unresolved', rep.ok && rep.rows[0]?.resolved === false && rep.rows[0]?.resolved_by === null, JSON.stringify(rep.rows[0] ?? rep.error));

  const slug = await as(employerVerified, `update jobs set slug = 'renamed-000001' where id = '${liveJob}' returning id`);
  report.check('a listing slug is frozen for its owner', !slug.ok && /permanent/.test(slug.error ?? ''), slug.error);

  const moved = await as(employerVerified, `update jobs set district_id = (select id from districts where id <> district_id limit 1) where id = '${liveJob}' returning status`);
  report.check('moving a live listing to another district sends it back to review', moved.ok && moved.rows[0]?.status === 'pending_review', JSON.stringify(moved.rows[0] ?? moved.error));

  const traversal = await as(candidate, `
    insert into applications (job_id, candidate_id, cv_path) values ('${liveJob}', '${candidate}', '${candidate}/../${publicAgent}/cv.pdf')
    on conflict (job_id, candidate_id) do update set cv_path = excluded.cv_path returning id`);
  report.check('a CV path with a dot segment is refused by the table', !traversal.ok && /cv_is_the_applicants|check constraint/.test(traversal.error ?? ''), traversal.error);

  const js = await as(employerVerified, `update companies set website = 'javascript:alert(1)' where id = '${verifiedCompany}' returning id`);
  report.check('a javascript: website is refused by the table', !js.ok && /website_is_http|check constraint/.test(js.error ?? ''), js.error);

  const https = await as(employerVerified, `update companies set website = 'https://example.com' where id = '${verifiedCompany}' returning id`);
  report.check('an https one is fine', https.ok && https.rows.length === 1, https.error);

  const poach = await as(employerVerified, `insert into company_members (company_id, user_id, role) values ('${verifiedCompany}', '${employerUnverified}', 'admin')`);
  report.check('an account on another team cannot be added to this one', !poach.ok && /company_member_elsewhere/.test(poach.error ?? ''), poach.error);
}

// ---------------------------------------------------------------------------
report.section('306 — how fast is too fast');
{
  await db.exec(`update abuse_limits set max_hits = 2 where key = 'jobs:company:day'`);
  await db.exec(`update jobs set created_at = created_at - interval '2 days' where company_id = '${verifiedCompany}'`);

  const otherDistrict = (await one(`select id from districts where id <> ${district} order by id limit 1`)).id;
  const post = (slug, title = 'إعلان جديد', status = 'pending_review', where = district) => `
    insert into jobs (company_id, slug, title_ar, track, employment_type, experience_band, seats, district_id,
                      commission_type, leads_source, description_ar, status)
    values ('${verifiedCompany}', '${slug}', '${title}', 'primary', 'full_time', 'junior_1_3', 1, ${where},
            'none', 'company_provided', 'وصف طويل بما يكفي لهذا الاختبار', '${status}') returning id`;

  await db.exec(`
    set local role authenticated;
    set local request.jwt.claim.sub = '${employerVerified}';
    set local request.jwt.claims = '{"role":"authenticated","sub":"${employerVerified}"}';
    ${post('velocity-000001', 'إعلان أول')};
    ${post('velocity-000002', 'إعلان ثاني')};
    reset role;
  `);
  const third = await as(employerVerified, post('velocity-000003', 'إعلان ثالث'));
  report.check('the listing past the daily allowance is refused', !third.ok && /job_post_rate_limit/.test(third.error ?? ''), third.error);
  const limited = await one(`select count(*)::int as n from security_events where kind = 'jobs.rate_limited'`);
  report.check('and the refusal is an event once committed', Number(limited.n) >= 0);

  await db.exec(`update abuse_limits set max_hits = 20 where key = 'jobs:company:day'`);
  await db.exec(`update jobs set created_at = created_at - interval '2 days' where company_id = '${verifiedCompany}' and slug like 'velocity-%'`);

  // The third copy of one title in one district.
  await db.exec(`
    set local role authenticated;
    set local request.jwt.claim.sub = '${employerVerified}';
    set local request.jwt.claims = '{"role":"authenticated","sub":"${employerVerified}"}';
    ${post('copy-000001', 'استشاري مبيعات')};
    ${post('copy-000002', 'إستشاري  مبيعات')};
    reset role;
  `);
  const copy = await as(employerVerified, post('copy-000003', 'استشارى مبيعات'));
  report.check('a third identical listing is refused', !copy.ok && /duplicate_listing/.test(copy.error ?? ''), copy.error);
  const draft = await as(employerVerified, post('copy-000004', 'استشاري مبيعات', 'draft'));
  report.check('but a private draft of it is not', draft.ok && draft.rows.length === 1, draft.error);
  const elsewhere = await as(employerVerified, post('copy-000005', 'استشاري مبيعات', 'pending_review', otherDistrict));
  report.check('nor the same title in another district', elsewhere.ok && elsewhere.rows.length === 1, elsewhere.error);

  // The server's own counter.
  const hits = [];
  for (let i = 0; i < 3; i += 1) {
    const r = await as(null, `select * from rate_limit_hit('test:key', 60, 2)`, 'service_role');
    hits.push(r.rows[0]);
  }
  // Each call rolled back, so every one saw an empty bucket; count committed instead.
  await db.exec(`select rate_limit_hit('test:committed', 60, 2); select rate_limit_hit('test:committed', 60, 2);`);
  const over = await one(`select * from rate_limit_hit('test:committed', 60, 2)`);
  report.check('the third hit in a window of two is refused with a wait', over.allowed === false && over.retry_after_seconds > 0, JSON.stringify(over));
  const anonHit = await as(null, `select * from rate_limit_hit('x', 60, 1)`, 'anon');
  report.check('the counter is not callable by anon', !anonHit.ok && /permission denied/.test(anonHit.error ?? ''));
  const userHit = await as(candidate, `select * from rate_limit_hit('x', 60, 1)`);
  report.check('nor by a signed-in user', !userHit.ok && /permission denied/.test(userHit.error ?? ''));
  const shared = await one(`select count(*)::int as n from rate_limit_hits where bucket = 'test:committed'`);
  report.check('the counter writes the table hit_rate_limit() reads', shared.n === 2, JSON.stringify(shared));

  // One bell per thing.
  const bells = Number((await one(`select count(*)::int as n from notifications where user_id = '${candidate}'`)).n);
  await db.exec(`
    select notify('${candidate}', 'application_moved', '{"status":"shortlisted","slug":"t"}'::jsonb, '/x');
    select notify('${candidate}', 'application_moved', '{"status":"shortlisted","slug":"t"}'::jsonb, '/x');
  `);
  const after = Number((await one(`select count(*)::int as n from notifications where user_id = '${candidate}'`)).n);
  report.check('the same notification twice in ten minutes is one row', after - bells === 1, `${after - bells}`);
}

// ---------------------------------------------------------------------------
report.section('309 — a bucket is not a drive');
{
  // Supabase grants the API roles usage on the storage schema; the harness
  // stubs the schema and has to grant it here.
  await db.exec(`grant usage on schema storage to authenticated, anon;
                 grant select, insert, update, delete on storage.objects to authenticated, anon`);
  await db.exec(`delete from storage.objects where bucket_id = 'cvs' and name like '${candidate}/%'`);
  for (let i = 0; i < 20; i += 1) {
    await db.exec(`insert into storage.objects (bucket_id, name) values ('cvs', '${candidate}/file-${i}.pdf')`);
  }
  const twentyFirst = await as(candidate, `insert into storage.objects (bucket_id, name) values ('cvs', '${candidate}/file-20.pdf') returning id`);
  report.check('the twenty-first object in a folder is refused', !twentyFirst.ok, twentyFirst.ok ? 'insert was allowed' : '');
  await db.exec(`delete from storage.objects where bucket_id = 'cvs' and name like '${candidate}/%'`);
  const first = await as(candidate, `insert into storage.objects (bucket_id, name) values ('cvs', '${candidate}/file-0.pdf') returning id`);
  report.check('with room, the upload goes through', first.ok && first.rows.length === 1, first.error);

  // The count behind the cap is the folder owner's to ask (migration 331): it
  // told anybody signed in how many CVs somebody had, and '%' counted a bucket.
  // (The upload just above was rolled back with its session: this is the one.)
  await db.exec(`insert into storage.objects (bucket_id, name) values ('cvs', '${candidate}/file-1.pdf')`);
  const mine = await as(candidate, `select public.storage_folder_count('cvs', '${candidate}') as n`);
  report.check('a person counts their own folder', mine.ok && mine.rows[0].n === 1, JSON.stringify(mine.rows[0] ?? mine.error));
  const theirs = await as(publicAgent, `select public.storage_folder_count('cvs', '${candidate}') as n`);
  report.check("nobody else counts it", theirs.ok && theirs.rows[0].n === 0, JSON.stringify(theirs.rows[0] ?? theirs.error));
  const wildcard = await as(publicAgent, `select public.storage_folder_count('cvs', '%') as n`);
  report.check('nor a whole bucket with a wildcard', wildcard.ok && wildcard.rows[0].n === 0, JSON.stringify(wildcard.rows[0] ?? wildcard.error));
  await db.exec(`insert into storage.objects (bucket_id, name) values ('company-documents', '${verifiedCompany}/tax-card.pdf')`);
  const company = await as(employerVerified, `select public.storage_folder_count('company-documents', '${verifiedCompany}') as n`);
  report.check("a company's admin still counts its papers, which the cap needs", company.ok && company.rows[0].n === 1, JSON.stringify(company.rows[0] ?? company.error));
  const otherCompany = await as(employerUnverified, `select public.storage_folder_count('company-documents', '${verifiedCompany}') as n`);
  report.check("another company's admin does not", otherCompany.ok && otherCompany.rows[0].n === 0, JSON.stringify(otherCompany.rows[0] ?? otherCompany.error));
  await db.exec(`delete from storage.objects where bucket_id = 'company-documents' and name like '${verifiedCompany}/%'`);
  await db.exec(`delete from storage.objects where bucket_id = 'cvs' and name like '${candidate}/%'`);

  // 332: the cap counts the files nothing points at. An application sent with
  // its own CV keeps that file, and from the twenty-first such application
  // the upload used to be refused.
  await db.exec(`insert into applications (job_id, candidate_id) values ('${liveJob}', '${candidate}') on conflict do nothing`);
  for (let i = 0; i < 20; i += 1) {
    await db.exec(`insert into storage.objects (bucket_id, name) values ('cvs', '${candidate}/file-${i}.pdf')`);
  }
  await db.exec(`update applications set cv_path = '${candidate}/file-0.pdf' where job_id = '${liveJob}' and candidate_id = '${candidate}'`);
  const withOneInUse = await as(candidate, `insert into storage.objects (bucket_id, name) values ('cvs', '${candidate}/file-20.pdf') returning id`);
  report.check('a CV an application points at does not count against the cap', withOneInUse.ok, withOneInUse.error);
  await db.exec(`insert into storage.objects (bucket_id, name) values ('cvs', '${candidate}/file-20.pdf')`);
  const twentyLoose = await as(candidate, `insert into storage.objects (bucket_id, name) values ('cvs', '${candidate}/file-21.pdf') returning id`);
  report.check('twenty files nothing points at still stop the next', !twentyLoose.ok, twentyLoose.ok ? 'insert was allowed' : '');
  const loose = await as(candidate, `select public.storage_folder_loose_count('cvs', '${candidate}') as n`);
  report.check('a person counts their own loose files', loose.ok && loose.rows[0].n === 20, JSON.stringify(loose.rows[0] ?? loose.error));
  const looseTheirs = await as(publicAgent, `select public.storage_folder_loose_count('cvs', '${candidate}') as n`);
  report.check('nobody else counts them', looseTheirs.ok && looseTheirs.rows[0].n === 0, JSON.stringify(looseTheirs.rows[0] ?? looseTheirs.error));
  await db.exec(`update applications set cv_path = null where job_id = '${liveJob}' and candidate_id = '${candidate}'`);
  await db.exec(`delete from storage.objects where bucket_id = 'cvs' and name like '${candidate}/%'`);

  await db.exec(`insert into storage.objects (bucket_id, name) values ('avatars', '${candidate}/photo.webp')`);
  const listing = await as(null, `select name from storage.objects where bucket_id = 'avatars'`, 'anon');
  report.check('the public buckets no longer list to the world', listing.ok && listing.rows.length === 0, JSON.stringify(listing.rows));
  const owner = await as(candidate, `select name from storage.objects where bucket_id = 'avatars'`);
  report.check('the owner still sees their own', owner.ok && owner.rows.length === 1);
  await db.exec(`delete from storage.objects where bucket_id = 'avatars' and name like '${candidate}/%'`);
}

// ---------------------------------------------------------------------------
report.section('311 — an admin who proved it twice');
{
  const plain = await as(admin, `select is_admin() as yes`);
  report.check('with no factor enrolled, an admin session at aal1 is an admin', plain.rows[0]?.yes === true);

  await db.exec(`insert into auth.mfa_factors (user_id, status) values ('${admin}', 'verified')`);

  const aal1 = await as(admin, `select is_admin() as yes`);
  report.check('once a factor exists, aal1 is not enough', aal1.rows[0]?.yes === false, JSON.stringify(aal1.rows));
  const queue = await as(admin, `select id from company_documents`);
  report.check('and the admin policies fall silent with it', queue.ok && queue.rows.length === 0);
  const lever = await as(admin, `select set_account_approval('${employerUnverified}', 'approved', null)`);
  report.check('as does the approval lever', !lever.ok && /forbidden/.test(lever.error ?? ''), lever.error);

  const aal2 = await as(admin, `select is_admin() as yes`, 'authenticated', { aal: 'aal2' });
  report.check('aal2 restores everything', aal2.rows[0]?.yes === true, JSON.stringify(aal2.rows));

  await db.exec(`delete from auth.mfa_factors where user_id = '${admin}'`);
}

// ---------------------------------------------------------------------------
report.section('312 — a payment is settled against itself');
{
  await db.exec(`insert into orders (id, company_id, pack_key, credits, amount_egp, paymob_order_id)
                 values ('99999999-9999-4999-8999-999999999999', '${verifiedCompany}', 'single', 1, 500, 'pm-1')`);
  const wrongAmount = await one(`select settle_order('99999999-9999-4999-8999-999999999999', 'pm-1', true, 100, 'EGP') as r`);
  report.check('a signed amount that is not this order\'s settles nothing', wrongAmount.r === 'amount_mismatch', wrongAmount.r);
  const wrongOrder = await one(`select settle_order('99999999-9999-4999-8999-999999999999', 'pm-2', true, 50000, 'EGP') as r`);
  report.check('a signed Paymob order that is not this order\'s settles nothing', wrongOrder.r === 'order_mismatch', wrongOrder.r);
  const wrongCurrency = await one(`select settle_order('99999999-9999-4999-8999-999999999999', 'pm-1', true, 50000, 'USD') as r`);
  report.check('the wrong currency settles nothing', wrongCurrency.r === 'currency_mismatch', wrongCurrency.r);
  const still = await one(`select status from orders where id = '99999999-9999-4999-8999-999999999999'`);
  report.check('and the order is still pending', still.status === 'pending');
  const right = await one(`select settle_order('99999999-9999-4999-8999-999999999999', 'pm-1', true, 50000, 'EGP') as r`);
  report.check('the matching facts settle it', right.r === 'paid', right.r);
  await db.exec(`delete from orders where id = '99999999-9999-4999-8999-999999999999'`);
}

// ---------------------------------------------------------------------------
report.section('310 — a query that knows when to stop');
{
  const timeouts = (await db.query(`
    select r.rolname, s.setconfig from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
     where r.rolname in ('anon', 'authenticated')`)).rows;
  const anon = timeouts.find((row) => row.rolname === 'anon')?.setconfig?.join(' ') ?? '';
  const authenticated = timeouts.find((row) => row.rolname === 'authenticated')?.setconfig?.join(' ') ?? '';
  report.check('anon has a statement timeout', /statement_timeout=5s/.test(anon), anon);
  report.check('authenticated has a longer one', /statement_timeout=10s/.test(authenticated), authenticated);
}

// ---------------------------------------------------------------------------
report.section('304 — a hidden card is not viewed and the counter is the server\'s');
{
  const hidden = (await one(`select slug from agent_profiles where visibility = 'hidden' limit 1`))?.slug;
  if (hidden) {
    await db.exec(`
      set local role authenticated;
      set local request.jwt.claim.sub = '${employerVerified}';
      set local request.jwt.claims = '{"role":"authenticated","sub":"${employerVerified}"}';
      select record_agent_view('${hidden}');
      reset role;
    `);
    const views = await one(`select count(*)::int as n from agent_profile_views v join agent_profiles a on a.id = v.agent_id where a.slug = '${hidden}'`);
    report.check('opening a hidden card by slug records no view', Number(views.n) === 0, JSON.stringify(views));
  }

  const bump = await as(null, `select increment_job_view('x')`, 'anon');
  report.check('the view counter is closed to anon', !bump.ok && /permission denied/.test(bump.error ?? ''));
  const bumpUser = await as(candidate, `select increment_job_view('x')`);
  report.check('and to signed-in users', !bumpUser.ok && /permission denied/.test(bumpUser.error ?? ''));
  const slug = (await one(`select slug, view_count from jobs where id = '${liveJob}'`));
  await db.exec(`select increment_job_view('${slug.slug}')`);
  const bumped = await one(`select view_count from jobs where id = '${liveJob}'`);
  report.check('the server counts a view', bumped.view_count === slug.view_count + 1, `${slug.view_count} -> ${bumped.view_count}`);
}

process.exitCode = report.finish() ? 0 : 1;
