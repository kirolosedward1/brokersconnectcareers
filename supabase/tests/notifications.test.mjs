/**
 * The notification architecture, exercised against the real migrations.
 * Run with: pnpm test:notifications  (also part of pnpm test:db)
 *
 * What this pins, in the order the brief asked for it: duplicates, retries,
 * wrong role, deleted targets, expired jobs, read state, pagination, a
 * notification failure that must not take the business write down with it,
 * and two tabs. The link rules and the cursor codec are pure TypeScript and
 * are tested alongside, in scripts/notifications.test.ts.
 */
import { createTestDb, runner, reporter, FIXTURES } from './setup.mjs';

const report = reporter();
const db = await createTestDb();
const as = runner(db);

const { employerVerified, candidate, admin } = FIXTURES;

/** Like `as`, but commits — for writes a later assertion needs to see. */
async function asCommit(userId, sql) {
  await db.exec('begin');
  try {
    await db.exec(`set local role authenticated;`);
    await db.exec(`set local request.jwt.claim.sub = '${userId}';`);
    await db.exec(`set local request.jwt.claims = '{"role":"authenticated","sub":"${userId}"}';`);
    const result = await db.query(sql);
    await db.exec('commit');
    return { ok: true, rows: result.rows };
  } catch (error) {
    await db.exec('rollback');
    return { ok: false, error: error.message, rows: [] };
  }
}

const count = async (where) =>
  (await db.query(`select count(*)::int as n from notifications where ${where}`)).rows[0].n;

// A fresh candidate and a recruiter, so the counts below start from nothing
// the seed or another suite wrote.
const APPLICANT = '66666666-6666-4666-8666-666666666666';
const MATE = '77777777-7777-4777-8777-777777777771';
const company = (
  await db.query(`select company_id from company_members where user_id = '${employerVerified}' and role = 'admin' limit 1`)
).rows[0].company_id;

await db.exec(`
  insert into auth.users (id, email) values ('${APPLICANT}', 'applicant@demo.test'), ('${MATE}', 'mate2@demo.test');
  insert into profiles (id, role, full_name, whatsapp_phone) values
    ('${APPLICANT}', 'candidate', 'متقدم', '+201666666666'),
    ('${MATE}', 'employer', 'زميل', '+201777777771');
  insert into company_members (company_id, user_id, role) values ('${company}', '${MATE}', 'recruiter');
`);

const job = (
  await db.query(`select id, slug from jobs where company_id = '${company}' and status = 'active'
                    and expires_at > now() order by id limit 1`)
).rows[0];

report.section('duplicates: one event, one notification per person');
{
  const apply = `insert into applications (job_id, candidate_id, status) values ('${job.id}', '${APPLICANT}', 'new')`;

  await db.exec(apply);
  const received = `user_id = '${MATE}' and kind = 'application_received' and payload->>'job_id' = '${job.id}'`;
  report.check('applying tells each company member once', (await count(received)) === 1);
  report.check('and the owner once',
    (await count(`user_id = '${employerVerified}' and kind = 'application_received' and dedupe_key = 'application_received:${job.id}:${APPLICANT}'`)) === 1);
  report.check('and the applicant gets a receipt',
    (await count(`user_id = '${APPLICANT}' and kind = 'application_submitted'`)) === 1);

  // Withdraw and apply again: the row is new, the event for the employer is not.
  await db.exec(`delete from applications where job_id = '${job.id}' and candidate_id = '${APPLICANT}'`);
  await db.exec(apply);
  report.check('apply → withdraw → apply rings the employer once, not twice',
    (await count(received)) === 1, String(await count(received)));
  report.check('but the applicant has a receipt for each thing they did',
    (await count(`user_id = '${APPLICANT}' and kind = 'application_submitted'`)) === 2);

  const app = (await db.query(`select id from applications where job_id = '${job.id}' and candidate_id = '${APPLICANT}'`)).rows[0].id;
  const moved = `user_id = '${APPLICANT}' and kind = 'application_moved'`;

  await db.exec(`update applications set status = 'shortlisted' where id = '${app}'`);
  // Saving the same stage twice: no status change, no trigger.
  await db.exec(`update applications set status = 'shortlisted' where id = '${app}'`);
  report.check('a double-click on the same stage is one notice', (await count(moved)) === 1);

  await db.exec(`update applications set status = 'new' where id = '${app}'`);
  report.check('moving back to "new" tells the candidate nothing', (await count(moved)) === 1);

  await db.exec(`update applications set status = 'shortlisted' where id = '${app}'`);
  report.check('and flapping back to shortlisted is not news twice', (await count(moved)) === 1);

  await db.exec(`update applications set status = 'interview' where id = '${app}'`);
  report.check('a real next stage is', (await count(moved)) === 2);

  // Two parallel writers: the second loses the insert rather than erroring.
  await db.exec(`
    select public.notify('${APPLICANT}', 'application_moved', '{}'::jsonb, '/dashboard/applications', 'application_moved:${app}:interview');
    select public.notify('${APPLICANT}', 'application_moved', '{}'::jsonb, '/dashboard/applications', 'application_moved:${app}:interview');
  `);
  report.check('two workers writing one key produce one row', (await count(moved)) === 2);
}

report.section('retries: replaying an event writes nothing new');
{
  const before = await count(`user_id = '${MATE}'`);
  // A webhook or trigger replay is a notify() call with a key already held.
  await db.exec(`select public.notify_company('${company}', 'application_received', '{}'::jsonb,
                   '/employer/jobs/${job.id}/applicants', 'application_received:${job.id}:${APPLICANT}')`);
  report.check('a replayed company notice is absorbed', (await count(`user_id = '${MATE}'`)) === before);

  // Moderation keyed on the row version: approving, editing, approving again
  // is two events; replaying one approval is one.
  const draft = (await db.query(`select id, version from jobs where company_id = '${company}' and status = 'active' and id <> '${job.id}' order by id limit 1`)).rows[0];
  if (draft) {
    const published = `user_id = '${MATE}' and kind = 'job_published' and payload->>'job_id' = '${draft.id}'`;
    const p0 = await count(published);
    await db.exec(`select public.notify_company('${company}', 'job_published', '{}'::jsonb, '/jobs/x', 'job_published:${draft.id}:${draft.version}')`);
    await db.exec(`select public.notify_company('${company}', 'job_published', '{}'::jsonb, '/jobs/x', 'job_published:${draft.id}:${draft.version}')`);
    report.check('a replayed moderation decision is one notice',
      (await count(`user_id = '${MATE}' and dedupe_key = 'job_published:${draft.id}:${draft.version}'`)) === 1 && p0 >= 0);
  }

  const forge = await as(MATE, `update notifications set dedupe_key = null where user_id = '${MATE}'`);
  report.check('a reader cannot clear a key to let a replay through',
    !forge.ok && /only read_at is user-writable/.test(forge.error ?? ''), forge.error);

  const direct = await as(MATE, `select public.notify('${MATE}', 'account_approved', '{}'::jsonb, null, 'x')`);
  report.check('nor call the writer themselves', !direct.ok, direct.ok ? 'allowed' : direct.error);
}

report.section('a notification failure does not roll back the business write');
{
  // Make every insert into the bell fail, as a broken trigger would.
  await db.exec(`alter table notifications add constraint test_bell_broken check (false) not valid`);

  const OTHER = (await db.query(`select id from jobs where company_id = '${company}' and status = 'active'
                    and expires_at > now() and id <> '${job.id}'
                    and not exists (select 1 from applications a where a.job_id = jobs.id and a.candidate_id = '${APPLICANT}')
                    order by id limit 1`)).rows[0]?.id;
  const r = await asCommit(APPLICANT,
    `insert into applications (job_id, candidate_id, experience_band) values ('${OTHER}', '${APPLICANT}', 'mid_3_5') returning id`);
  report.check('the application is recorded even though its notifications failed',
    r.ok && r.rows.length === 1, r.error);
  report.check('and no half-written notice exists for it',
    (await count(`kind = 'application_submitted' and payload->>'job_id' = '${OTHER}' and user_id = '${APPLICANT}'`)) === 0);

  await db.exec(`alter table notifications drop constraint test_bell_broken`);
  if (r.ok) await db.exec(`delete from applications where id = '${r.rows[0].id}'`);
}

report.section('expired and expiring listings');
{
  const [soon, ended, old] = (
    await db.query(`select id from jobs where company_id = '${company}' order by id limit 3`)
  ).rows.map((row) => row.id);

  // Straight to the dates, bypassing the lifecycle triggers that would restamp them.
  await db.exec(`
    alter table jobs disable trigger user;
    update jobs set status = 'active',  published_at = now() - interval '28 days', expires_at = now() + interval '2 days'  where id = '${soon}';
    update jobs set status = 'active',  published_at = now() - interval '31 days', expires_at = now() - interval '1 day'   where id = '${ended}';
    update jobs set status = 'expired', published_at = now() - interval '90 days', expires_at = now() - interval '60 days' where id = '${old}';
    alter table jobs enable trigger user;
  `);

  const first = (await db.query(`select public.emit_job_expiry_notifications('${company}') as n`)).rows[0].n;
  report.check('the sweep writes notices for this company', first > 0, String(first));
  report.check('"ends soon" for the listing inside the window',
    (await count(`user_id = '${MATE}' and kind = 'job_expiring' and payload->>'job_id' = '${soon}'`)) === 1);
  report.check('"ended" by the date, even while the label still says active',
    (await count(`user_id = '${MATE}' and kind = 'job_expired' and payload->>'job_id' = '${ended}'`)) === 1);
  report.check('and nothing for one that ended two months ago',
    (await count(`kind in ('job_expired','job_expiring') and payload->>'job_id' = '${old}'`)) === 0);

  const again = (await db.query(`select public.emit_job_expiry_notifications('${company}') as n`)).rows[0].n;
  report.check('running it again — cron and console both — writes nothing', again === 0, String(again));

  // Renewed and ending again is a new window, and a new notice.
  await db.exec(`alter table jobs disable trigger user;
                 update jobs set expires_at = now() - interval '2 hours' where id = '${ended}';
                 alter table jobs enable trigger user;`);
  await db.query(`select public.emit_job_expiry_notifications('${company}')`);
  report.check('a reposted listing that ends again is told again',
    (await count(`user_id = '${MATE}' and kind = 'job_expired' and payload->>'job_id' = '${ended}'`)) === 2);

  const mine = await asCommit(employerVerified, `select public.sync_my_job_notifications() as n`);
  report.check('an employer can run the sweep for their own company', mine.ok, mine.error);

  const cand = await as(candidate, `select public.sync_my_job_notifications() as n`);
  report.check('a candidate running it writes nothing', cand.ok && cand.rows[0].n === 0, cand.error);

  const everyone = await as(employerVerified, `select public.emit_job_expiry_notifications(null)`);
  report.check('but nobody signed in can sweep other companies', !everyone.ok, everyone.ok ? 'allowed' : everyone.error);

  const anon = await as(null, `select public.sync_my_job_notifications()`, 'anon');
  report.check('and anonymous cannot call it at all', !anon.ok, anon.ok ? 'allowed' : anon.error);
}

report.section('verification, visibility, and the account itself');
{
  await db.exec(`update companies set verification_status = 'rejected' where id = '${company}'`);
  report.check('a refused verification reaches the bell, not only the inbox',
    (await count(`user_id = '${MATE}' and kind = 'company_verification_needed'`)) === 1);
  await db.exec(`update companies set verification_status = 'verified' where id = '${company}'`);

  const agent = (await db.query(`select user_id, visibility from agent_profiles where user_id = '${candidate}'`)).rows[0];
  if (agent) {
    const visible = `user_id = '${candidate}' and kind = 'profile_visibility_changed'`;
    const v0 = await count(visible);
    const next = agent.visibility === 'hidden' ? 'public' : 'hidden';
    const r = await asCommit(candidate, `update agent_profiles set visibility = '${next}' where user_id = '${candidate}' returning id`);
    report.check('changing who can see you is recorded', r.ok && (await count(visible)) === v0 + 1, r.error);
    await asCommit(candidate, `update agent_profiles set visibility = '${agent.visibility}' where user_id = '${candidate}'`);
    await asCommit(candidate, `update agent_profiles set visibility = '${next}' where user_id = '${candidate}'`);
    report.check('toggling back and forth all day is one notice per setting',
      (await count(visible)) === v0 + 2, String((await count(visible)) - v0));
    // An edit that does not touch visibility is not a visibility event.
    await asCommit(candidate, `update agent_profiles set headline_ar = coalesce(headline_ar, '') || ' ' where user_id = '${candidate}'`);
    report.check('and fixing a typo is none', (await count(visible)) === v0 + 2);
  }
}

report.section('read state, and whose it is');
{
  const mine = (await db.query(`select id, href from notifications where user_id = '${MATE}' and read_at is null order by created_at desc limit 1`)).rows[0];
  const theirs = (await db.query(`select id from notifications where user_id = '${APPLICANT}' limit 1`)).rows[0];

  const open = await asCommit(MATE, `select * from public.open_notification('${mine.id}')`);
  report.check('opening one returns where it points', open.ok && open.rows[0]?.href === mine.href, open.error);
  const stamp = (await db.query(`select read_at from notifications where id = '${mine.id}'`)).rows[0].read_at;
  report.check('and marks it read', stamp !== null);

  await asCommit(MATE, `select * from public.open_notification('${mine.id}')`);
  const again = (await db.query(`select read_at from notifications where id = '${mine.id}'`)).rows[0].read_at;
  report.check('opening it again keeps the first read time', String(again) === String(stamp));

  const peek = await asCommit(MATE, `select * from public.open_notification('${theirs.id}')`);
  report.check("somebody else's id opens nothing", peek.ok && peek.rows.length === 0, peek.error);
  report.check('and leaves it unread',
    (await db.query(`select read_at from notifications where id = '${theirs.id}'`)).rows[0].read_at === null);

  const anon = await as(null, `select * from public.open_notification('${theirs.id}')`, 'anon');
  report.check('anonymous cannot open anything', !anon.ok || anon.rows.length === 0);
}

report.section('two tabs: mark-all only clears what the tab had seen');
{
  const unread = `user_id = '${MATE}' and read_at is null`;
  // Tab A rendered at t0; a notice arrives after.
  const seen = (await db.query(`select max(created_at) as t from notifications where user_id = '${MATE}'`)).rows[0].t;
  await db.exec(`insert into notifications (user_id, kind, payload, created_at, dedupe_key)
                 values ('${MATE}', 'application_received', '{}'::jsonb, now() + interval '1 minute', 'late-arrival')`);

  const r = await asCommit(MATE, `select public.mark_notifications_read('${new Date(seen).toISOString()}') as n`);
  report.check('the stale tab marks what it showed', r.ok && r.rows[0].n >= 0, r.error);
  report.check('and the one that arrived after it rendered stays unread',
    (await count(`${unread} and dedupe_key = 'late-arrival'`)) === 1);

  await asCommit(MATE, `select public.mark_notifications_read() as n`);
  report.check('an unbounded mark-all clears everything', (await count(unread)) === 0);

  // Both tabs pressing it: the second finds nothing to do and says so.
  const second = await asCommit(MATE, `select public.mark_notifications_read() as n`);
  report.check('the second tab pressing it is a harmless zero', second.ok && second.rows[0].n === 0);
}

report.section('pagination: keyset pages never repeat or skip, even on ties');
{
  // Fifty rows with the same timestamp — the case an offset or a created_at-only
  // cursor gets wrong.
  await db.exec(`
    insert into notifications (user_id, kind, payload, created_at, dedupe_key)
    select '${APPLICANT}', 'application_submitted', '{}'::jsonb, '2026-01-01T00:00:00Z', 'tie-' || g
      from generate_series(1, 50) g;
  `);
  const total = await count(`user_id = '${APPLICANT}'`);

  const seenIds = new Set();
  let cursor = null;
  let pages = 0;
  for (;;) {
    const where = cursor
      ? `and (created_at < '${cursor.at}' or (created_at = '${cursor.at}' and id < '${cursor.id}'))`
      : '';
    const page = await as(APPLICANT, `
      select id, created_at from notifications
       where user_id = '${APPLICANT}' ${where}
       order by created_at desc, id desc limit 21`);
    const rows = page.rows.slice(0, 20);
    for (const row of rows) seenIds.add(row.id);
    pages += 1;
    if (page.rows.length <= 20 || pages > 20) break;
    const last = rows.at(-1);
    cursor = { at: new Date(last.created_at).toISOString(), id: last.id };
  }
  report.check(`every row appears exactly once across ${pages} pages`, seenIds.size === total,
    `${seenIds.size} of ${total}`);

  const plan = await db.query(`explain select id from notifications where user_id = '${APPLICANT}'
                                 order by created_at desc, id desc limit 21`);
  report.check('and the page is served by the feed index, not a sort of the whole table',
    plan.rows.some((row) => /notifications_feed_page_idx|Index/.test(Object.values(row)[0])),
    JSON.stringify(plan.rows.map((row) => Object.values(row)[0])));
}

report.section('deleted targets');
{
  // A notification survives the listing it is about — the snapshot is
  // deliberate (migration 17) — and the reader's session can tell it is gone,
  // which is what openNotification checks before following the link.
  const victim = (await db.query(`
    insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band,
                      district_id, commission_type, leads_source, description_ar, status,
                      published_at, expires_at)
    values ('${company}', 'وظيفة محذوفة للاختبار', 'notification-deleted-target-test',
            'primary', 'full_time', 'junior_1_3', (select id from districts limit 1),
            'none', 'company_provided', 'وصف', 'active', now(), now() + interval '30 days')
    returning id
  `)).rows[0].id;
  await db.exec(`select public.notify_company('${company}', 'job_published',
                   jsonb_build_object('job_id', '${victim}'), '/employer/jobs/${victim}/edit', 'deleted-target-${victim}')`);
  await db.exec(`delete from jobs where id = '${victim}'`);

  report.check('the notice outlives the listing',
    (await count(`user_id = '${MATE}' and dedupe_key = 'deleted-target-${victim}'`)) === 1);
  const lookup = await as(MATE, `select id from jobs where id = '${victim}'`);
  report.check("and the reader's own lookup finds nothing to send them to", lookup.ok && lookup.rows.length === 0);
}

report.section('wrong role: rows reach only the people they are about');
{
  const employerKinds = `('application_received','application_withdrawn','job_published','job_rejected','job_expiring','job_expired','company_verified','company_verification_needed')`;
  const leaked = await db.query(`
    select n.kind, p.role from notifications n join profiles p on p.id = n.user_id
     where n.kind in ${employerKinds} and p.role = 'candidate'`);
  report.check('no candidate holds an employer notice', leaked.rows.length === 0, JSON.stringify(leaked.rows.slice(0, 3)));

  const candidateKinds = `('application_submitted','application_moved','profile_visibility_changed')`;
  const wrongWay = await db.query(`
    select n.kind, p.role from notifications n join profiles p on p.id = n.user_id
     where n.kind in ${candidateKinds} and p.role = 'employer'`);
  report.check('no employer holds a candidate notice', wrongWay.rows.length === 0, JSON.stringify(wrongWay.rows.slice(0, 3)));

  const hrefs = await db.query(`
    select n.kind, n.href, p.role from notifications n join profiles p on p.id = n.user_id
     where (p.role = 'candidate' and n.href like '/employer%')
        or (p.role = 'employer'  and n.href like '/dashboard%' and n.href not like '/dashboard/account%')`);
  report.check('and no stored link points into the other side of the site',
    hrefs.rows.length === 0, JSON.stringify(hrefs.rows.slice(0, 3)));
}

report.section('twenty applicants are one row until somebody reads it');
{
  const C = [1, 2, 3, 4].map((n) => `88888888-0000-4000-8000-00000000000${n}`);
  await db.exec(`
    insert into auth.users (id, email) values ${C.map((id, i) => `('${id}', 'fold${i}@demo.test')`).join(', ')};
    insert into profiles (id, role, full_name, whatsapp_phone) values
      ${C.map((id, i) => `('${id}', 'candidate', 'متقدم ${i}', '+20100000080${i}')`).join(', ')};
  `);
  const target = (
    await db.query(`select id from jobs where company_id = '${company}' and status = 'active'
                      and expires_at > now() order by id desc limit 1`)
  ).rows[0].id;

  // Whatever earlier sections and the seed left on this listing is history:
  // read it, and leave it out of what is counted below.
  await db.exec(`update notifications set read_at = now()
                  where read_at is null and user_id in ('${MATE}', '${employerVerified}')`);
  const t0 = (await db.query(`select now() as t`)).rows[0].t;
  const since = `and created_at >= '${new Date(t0).toISOString()}'`;

  const apply = (who) =>
    db.exec(`insert into applications (job_id, candidate_id, status) values ('${target}', '${who}', 'new')`);
  const heads = () =>
    db.query(`select id, payload->>'count' as n, read_at from notifications
               where user_id = '${MATE}' and kind = 'application_received'
                 and payload->>'job_id' = '${target}' and folded_into is null ${since}
               order by created_at desc`);
  const all = `user_id = '${MATE}' and kind = 'application_received' and payload->>'job_id' = '${target}' ${since}`;

  await apply(C[0]);
  let h = (await heads()).rows;
  report.check('the first applicant is a row of its own', h.length === 1 && h[0].n === '1', JSON.stringify(h));

  await apply(C[1]);
  await apply(C[2]);
  h = (await heads()).rows;
  report.check('the next two fold into it: one row, "3 new"', h.length === 1 && h[0].n === '3', JSON.stringify(h));
  report.check('each person still has their own keyed row underneath', (await count(all)) === 3);
  report.check('and the badge counts the listing once, not three times',
    (await count(`${all} and read_at is null`)) === 1);

  await db.exec(`delete from applications where job_id = '${target}' and candidate_id = '${C[1]}'`);
  await apply(C[1]);
  h = (await heads()).rows;
  report.check('withdrawing and reapplying does not count the same person twice', h[0].n === '3', JSON.stringify(h));

  await db.exec(`select public.notify_company_applicant('${company}', '${target}', '{}'::jsonb, '/x',
                   'application_received:${target}:${C[0]}')`);
  report.check('nor does a replay', (await heads()).rows[0].n === '3');

  await asCommit(MATE, `select * from public.open_notification('${h[0].id}')`);
  await apply(C[3]);
  h = (await heads()).rows;
  report.check('once read, the next applicant starts a fresh row: "new since you looked"',
    h.length === 2 && h[0].n === '1' && h[0].read_at === null && h[1].n === '3', JSON.stringify(h));

  const smuggle = await as(MATE, `update notifications set folded_into = null where user_id = '${MATE}' and folded_into is not null`);
  report.check('a reader cannot unfold rows to inflate their feed',
    !smuggle.ok && /only read_at is user-writable/.test(smuggle.error ?? ''), smuggle.error);

  const bump = await as(MATE, `update notifications set payload = payload || '{"count": 99}' where id = '${h[0].id}'`);
  report.check('nor rewrite the count', !bump.ok, bump.ok ? 'allowed' : bump.error);

  const gone = await asCommit(MATE, `delete from notifications where id = '${h[1].id}' returning id`);
  report.check('deleting a folded row takes the rows it absorbed with it',
    gone.ok && (await count(`folded_into = '${h[1].id}'`)) === 0, gone.error);

  // The owner folds independently: their read state is theirs.
  const ownerHeads = await db.query(`select payload->>'count' as n from notifications
    where user_id = '${employerVerified}' and kind = 'application_received'
      and payload->>'job_id' = '${target}' and folded_into is null and read_at is null ${since}`);
  report.check("another member's row is untouched by this member reading theirs",
    ownerHeads.rows.length === 1 && ownerHeads.rows[0].n === '4', JSON.stringify(ownerHeads.rows));

  await db.exec(`delete from auth.users where id in (${C.map((id) => `'${id}'`).join(', ')})`);
}

report.section('retention: read history older than 180 days is pruned');
{
  await db.exec(`
    insert into notifications (user_id, kind, payload, created_at, read_at, dedupe_key) values
      ('${MATE}', 'job_published', '{}'::jsonb, now() - interval '200 days', now() - interval '199 days', 'old-read'),
      ('${MATE}', 'job_published', '{}'::jsonb, now() - interval '200 days', null,                        'old-unread'),
      ('${MATE}', 'job_published', '{}'::jsonb, now() - interval '10 days',  now() - interval '9 days',   'young-read'),
      ('${APPLICANT}', 'application_moved', '{}'::jsonb, now() - interval '400 days', now() - interval '399 days', 'ancient');
  `);

  await asCommit(MATE, `select public.mark_notifications_read() as n`);
  report.check("clearing your feed prunes your own old read history",
    (await count(`dedupe_key = 'old-read'`)) === 0);
  report.check('but never something you had not read yet', (await count(`dedupe_key = 'old-unread'`)) === 1);
  report.check('nor anything recent', (await count(`dedupe_key = 'young-read'`)) === 1);
  report.check("nor anybody else's", (await count(`dedupe_key = 'ancient'`)) === 1);

  const pruned = (await db.query(`select public.prune_notifications() as n`)).rows[0].n;
  report.check('the cron sweep prunes everybody else', pruned >= 1 && (await count(`dedupe_key = 'ancient'`)) === 0,
    String(pruned));

  const byUser = await as(MATE, `select public.prune_notifications()`);
  report.check('and is not callable by a signed-in user', !byUser.ok, byUser.ok ? 'allowed' : byUser.error);
}

report.section('a retried email knows who it was for');
{
  // Due now: since migration 315 a row is due by next_attempt_at, which a
  // claim sets five minutes out and a failed attempt moves on by backoff.
  await db.exec(`insert into email_log (template, recipient, user_id, entity_type, entity_id, status, created_at, next_attempt_at)
                 values ('job_submitted', 'mate2@demo.test', '${MATE}', 'job', '${job.id}', 'failed', now() - interval '10 minutes', now() - interval '5 minutes')`);
  const pending = await db.query(`select * from public.pending_emails(100) where template = 'job_submitted'`);
  report.check('the sweeper is handed the recipient as well as the entity',
    pending.rows.some((row) => row.user_id === MATE && row.entity_id === job.id), JSON.stringify(pending.rows));
}

report.section('code written against the four-argument writers keeps working');
{
  // Migration 201's support answer calls notify(user, kind, payload, href).
  // Dropping that form would make answering a ticket fail; the shim forwards
  // it with a key derived from the content instead.
  const where = `user_id = '${APPLICANT}' and kind = 'account_approved' and href = '/shim-check'`;
  const call = (note) => db.exec(`select public.notify('${APPLICANT}', 'account_approved',
                                    jsonb_build_object('note', '${note}'), '/shim-check')`);
  await call('first');
  report.check('the old form still writes', (await count(where)) === 1);
  await call('first');
  report.check('and the same notice replayed word for word is one row', (await count(where)) === 1);
  await call('second');
  report.check('while a different one is a new row', (await count(where)) === 2);

  const direct = await as(APPLICANT, `select public.notify('${APPLICANT}', 'account_approved', '{}'::jsonb, null)`);
  report.check('and it is no more callable by a user than the new one', !direct.ok, direct.ok ? 'allowed' : direct.error);

  const co = `kind = 'company_verified' and href = '/shim-co'`;
  await db.exec(`select public.notify_company('${company}', 'company_verified', '{}'::jsonb, '/shim-co')`);
  await db.exec(`select public.notify_company('${company}', 'company_verified', '{}'::jsonb, '/shim-co')`);
  const members = (await db.query(`select count(*)::int n from company_members where company_id = '${company}'`)).rows[0].n;
  report.check('the company form too: one per member, replay absorbed', (await count(co)) === members,
    `${await count(co)} rows for ${members} members`);
}

report.section('the server can reach what only the server may call');
{
  /*
    notify() for the password notice, the expiry sweep and the prune for the
    crons, pending_emails() for the retry sweeper: each is revoked from every
    API role and must still be callable by the service role — explicitly
    granted, not inherited from default privileges that depend on who ran the
    migration.
  */
  const SERVER_ONLY = [
    'notify(uuid, notification_kind, jsonb, text, text)',
    'emit_job_expiry_notifications(uuid, integer)',
    'prune_notifications(integer)',
    'pending_emails(integer)',
  ];
  for (const sig of SERVER_ONLY) {
    const { rows } = await db.query(`
      select has_function_privilege('service_role', 'public.${sig}', 'EXECUTE') as sr,
             has_function_privilege('authenticated', 'public.${sig}', 'EXECUTE') as au,
             has_function_privilege('anon', 'public.${sig}', 'EXECUTE') as an,
             exists (
               select 1 from pg_proc p, aclexplode(p.proacl) a
                where p.oid = 'public.${sig}'::regprocedure
                  and a.grantee = 'service_role'::regrole and a.privilege_type = 'EXECUTE'
             ) as explicit`);
    const r = rows[0];
    report.check(`${sig.split('(')[0]}: service role yes (explicitly), signed-in and anonymous no`,
      r.sr && r.explicit && !r.au && !r.an, JSON.stringify(r));
  }

  // And actually calling them as the service role works end to end.
  const asServer = await as(null, `
    select public.prune_notifications(1) as pruned,
           public.emit_job_expiry_notifications(null, 3) as swept,
           (select count(*) from public.pending_emails(1)) as pending`, 'service_role');
  report.check('called as the service role, each one runs', asServer.ok, asServer.error);
}

await db.exec(`delete from auth.users where id in ('${APPLICANT}', '${MATE}')`);
void admin;

process.exit(report.finish() ? 0 : 1);
