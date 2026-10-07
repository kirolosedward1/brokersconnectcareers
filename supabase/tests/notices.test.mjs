/**
 * Notices that went quiet when they mattered most (migration 345), against
 * the real migrations.
 * Run with: pnpm test:notices  (also part of pnpm test:db)
 *
 * Three of them: a stage told a second time (rejected, reconsidered, rejected
 * again), a review that asks a company for new papers, and the profile
 * reminder's list. The bell's rule for a stage and the email's
 * (src/lib/application-arrival.ts) are held to each other over random
 * histories, so the two channels cannot drift apart on what "once" means.
 */
import { createTestDb, reporter, FIXTURES } from './setup.mjs';
import { isNews, stageTelling, tellingSuffix } from '../../src/lib/application-arrival.ts';

const report = reporter();
const db = await createTestDb();

const HUB = 'aaaaaaaa-0000-0000-0000-000000000002'; // employer2's, unverified
const { admin, employerVerified, employerUnverified: E2 } = FIXTURES;

const rows = async (sql) => (await db.query(sql)).rows;

/**
 * Steps in one transaction, each as somebody — `as: null` is the database
 * itself — and all of it rolled back at the end, as in doors.test.mjs.
 */
async function scenario(steps) {
  const results = [];
  await db.exec('begin');
  try {
    for (const { as: userId, sql } of steps) {
      if (userId === null) {
        await db.exec("reset role; set local request.jwt.claim.sub = ''; set local request.jwt.claims = '';");
      } else {
        await db.exec('set local role authenticated;');
        await db.exec(`set local request.jwt.claim.sub = '${userId}';`);
        await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: userId })}';`);
      }
      await db.exec('savepoint step;');
      try {
        results.push({ ok: true, rows: (await db.query(sql)).rows });
        await db.exec('release savepoint step;');
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

// Fresh candidates, so nothing the seed wrote is in their bell.
const company = (
  await rows(`select company_id from company_members where user_id = '${employerVerified}' and role = 'admin' limit 1`)
)[0].company_id;
const jobs = (
  await rows(`select id from jobs where company_id = '${company}' and status = 'active'
               and expires_at > now() order by id limit 6`)
).map((row) => row.id);

let next = 0;
async function freshApplication() {
  next += 1;
  const id = `88888888-8888-4888-8888-${String(next).padStart(12, '0')}`;
  await db.exec(`
    insert into auth.users (id, email) values ('${id}', 'stage-${next}@demo.test');
    insert into profiles (id, role, full_name, whatsapp_phone) values ('${id}', 'candidate', 'مرشح', '+2010${String(next).padStart(8, '0')}');
  `);
  const [application] = await rows(`
    insert into applications (job_id, candidate_id, status) values ('${jobs[next % jobs.length]}', '${id}', 'new')
    returning id`);
  return { candidate: id, application: application.id };
}

const move = (application, status) => db.exec(`update applications set status = '${status}' where id = '${application}'`);

/**
 * The stage notices this application has rung, oldest first. In the order
 * they were written — each move is a transaction of its own (xmin), one
 * statement (cmin) — not by created_at: two moves in the same millisecond
 * share a timestamp under PGlite's clock, and then a random id decided the
 * order, so the test failed now and then (CI on 899ac9e).
 */
const told = async (application) =>
  (
    await rows(`select dedupe_key, payload->>'status' as status from notifications
                 where kind = 'application_moved' and dedupe_key like 'application_moved:${application}:%'
                 order by xmin::text::bigint, cmin::text::bigint, created_at, id`)
  ).map((row) => ({ key: row.dedupe_key.slice(`application_moved:${application}:`.length), status: row.status }));
const keys = async (application) => (await told(application)).map((notice) => notice.key);

report.section('the email counts a stage the way a candidate hears it');
{
  report.check('the first time a stage is told is 1', stageTelling(['new', 'shortlisted'], 'shortlisted') === 1);
  report.check(
    'and keeps the key it always had',
    tellingSuffix(stageTelling(['new', 'rejected'], 'rejected')) === '',
  );
  report.check(
    'rejected → shortlisted → rejected is the second rejection',
    stageTelling(['new', 'rejected', 'shortlisted', 'rejected'], 'rejected') === 2 &&
      tellingSuffix(2) === ':2',
  );
  report.check(
    'tidied back to "new" and out again is the same telling, not another',
    stageTelling(['new', 'shortlisted', 'new', 'shortlisted'], 'shortlisted') === 1,
  );
  report.check(
    'a history that could not be read is the first telling — the old key',
    stageTelling([], 'interview') === 1,
  );
  report.check(
    'tidied back to "new" and out again is not news at all, whatever the key',
    isNews(['new', 'shortlisted', 'new', 'shortlisted'], 'shortlisted') === false,
  );
  report.check(
    'a stage told again after another one is',
    isNews(['new', 'rejected', 'shortlisted', 'rejected'], 'rejected') === true &&
      isNews(['new', 'interview'], 'interview') === true &&
      isNews([], 'interview') === true,
  );
  report.check(
    'nor is a stage the candidate heard before 345 swallowed its second telling',
    isNews(['rejected', 'shortlisted', 'rejected', 'new', 'rejected'], 'rejected') === false,
  );
}

report.section('a stage told a second time reaches the candidate');
{
  const { application } = await freshApplication();

  await move(application, 'rejected');
  report.check('a first rejection is told, under the key it always had', JSON.stringify(await keys(application)) === '["rejected"]', JSON.stringify(await keys(application)));

  await move(application, 'shortlisted');
  await move(application, 'rejected');
  const afterSecond = await told(application);
  report.check(
    'reconsidered and rejected again: the second rejection is told',
    JSON.stringify(afterSecond.map((notice) => notice.key)) === '["rejected","shortlisted","rejected:2"]',
    JSON.stringify(afterSecond),
  );
  report.check(
    'so their last word from us is the stage they are at',
    afterSecond.at(-1)?.status === 'rejected',
    JSON.stringify(afterSecond.at(-1)),
  );

  await move(application, 'new');
  await move(application, 'rejected');
  report.check(
    'tidied back to "new" and out to the same stage: nothing new',
    (await keys(application)).length === 3,
    JSON.stringify(await keys(application)),
  );

  await move(application, 'interview');
  await move(application, 'shortlisted');
  report.check(
    'moved back a stage: told, because their last word said "interview"',
    JSON.stringify((await keys(application)).slice(3)) === '["interview","shortlisted:2"]',
    JSON.stringify(await keys(application)),
  );

  await move(application, 'shortlisted');
  report.check('saving the same stage twice is still one notice', (await keys(application)).length === 5);
}

report.section('whichever trigger runs first');
{
  // The trigger that records a move runs after the one that tells the
  // candidate (AFTER triggers fire by name). Swapped, the answer is the same.
  const before = await freshApplication();
  const after = await freshApplication();
  const walk = ['rejected', 'shortlisted', 'rejected', 'new', 'rejected', 'interview', 'shortlisted'];
  for (const status of walk) await move(before.application, status);

  await db.exec('begin');
  try {
    await db.exec('alter trigger applications_record_event on applications rename to applications_a_record_event');
    const order = await rows(`select tgname from pg_trigger
                               where tgrelid = 'applications'::regclass
                                 and tgname in ('applications_a_record_event', 'applications_notify_candidate')
                               order by tgname`);
    report.check('(recording now runs first)', order[0]?.tgname === 'applications_a_record_event', JSON.stringify(order));
    for (const status of walk) await move(after.application, status);
    // As sets: inside one transaction every row has the same created_at.
    const swapped = (await keys(after.application)).sort();
    const original = (await keys(before.application)).sort();
    report.check(
      'the candidate is told the same things',
      JSON.stringify(swapped) === JSON.stringify(original),
      `${JSON.stringify(swapped)} vs ${JSON.stringify(original)}`,
    );
  } finally {
    await db.exec('rollback');
  }
}

report.section('the bell and the email agree, over random histories');
{
  // A fixed seed: the same histories on every run.
  let state = 345;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const STAGES = ['new', 'shortlisted', 'interview', 'hired', 'rejected'];

  let agreed = 0;
  let stepsAgreed = 0;
  const disagreements = [];
  const stepDisagreements = [];
  for (let walk = 0; walk < 12; walk += 1) {
    const { application } = await freshApplication();
    const history = ['new'];
    const emailKeys = new Set();
    for (let step = 0; step < 20; step += 1) {
      const current = history.at(-1);
      const choices = STAGES.filter((stage) => stage !== current);
      const status = choices[Math.floor(random() * choices.length)];
      const rungBefore = (await told(application)).length;
      await move(application, status);
      history.push(status);
      // What notifyCandidateOfStatus decides for this move: whether it is
      // news at all, and if so the key its email goes out under. Decided from
      // the history, step by step, not left to a key the outbox may no longer
      // hold.
      const emails = status !== 'new' && isNews(history, status);
      if (emails) emailKeys.add(`${status}${tellingSuffix(stageTelling(history, status))}`);
      const rang = (await told(application)).length > rungBefore;
      if (rang === emails) stepsAgreed += 1;
      else stepDisagreements.push({ history: [...history], rang, emails });
    }
    const bell = new Set(await keys(application));
    const same = bell.size === emailKeys.size && [...bell].every((key) => emailKeys.has(key));
    if (same) agreed += 1;
    else disagreements.push({ history, bell: [...bell], email: [...emailKeys] });
  }
  report.check(
    `every history rings the bell with exactly the email's keys (${agreed} of 12)`,
    agreed === 12,
    JSON.stringify(disagreements[0]),
  );
  report.check(
    `and every single move rings the bell exactly when it is emailed (${stepsAgreed} of 240)`,
    stepsAgreed === 240,
    JSON.stringify(stepDisagreements[0]),
  );
}

report.section('a review that asks for new papers rings the bell');
{
  const needed = `select count(*)::int as n from notifications
                   where user_id = '${E2}' and kind = 'company_verification_needed'`;
  const submit = (name) => [
    {
      as: null,
      sql: `insert into storage.objects (bucket_id, name, owner) values ('company-documents', '${HUB}/${name}.pdf', '${E2}')`,
    },
    {
      as: null,
      sql: `insert into company_documents (company_id, doc_type, storage_path, status)
            values ('${HUB}', 'commercial_register', '${HUB}/${name}.pdf', 'pending') returning id`,
    },
  ];
  const status = { as: null, sql: `select verification_status::text as status from companies where id = '${HUB}'` };

  const results = await scenario([
    { as: null, sql: needed },
    ...submit('first'),
    status,
    { as: admin, sql: `select admin_review_company('${HUB}', 'request_changes', 'صورة السجل غير واضحة') as status` },
    { as: null, sql: needed },
    ...submit('second'),
    { as: admin, sql: `select admin_review_company('${HUB}', 'request_changes', 'الختم غير ظاهر') as status` },
    { as: null, sql: needed },
  ]);
  const [start, , , pending, reviewed, once, , , again, twice] = results;
  report.check('(a paper sent puts the company in the queue)', pending.rows[0]?.status === 'pending', JSON.stringify(pending.rows[0] ?? pending.error));
  report.check('(the reviewer asks for changes)', reviewed.ok && reviewed.rows[0]?.status === 'unverified', reviewed.error);
  report.check(
    'the company hears it in the bell, as it would a refusal',
    once.rows[0]?.n === start.rows[0]?.n + 1,
    `${start.rows[0]?.n} → ${once.rows[0]?.n}`,
  );
  report.check(
    'and a second round of changes is told again',
    again.ok && twice.rows[0]?.n === start.rows[0]?.n + 2,
    `${once.rows[0]?.n} → ${twice.rows[0]?.n} ${again.error ?? ''}`,
  );

  // The database itself taking the last paper waiting out of the queue (a
  // clean-up, a deletion) takes the same path back to unverified.
  const removed = await scenario([
    { as: null, sql: needed },
    ...submit('third'),
    { as: null, sql: `delete from company_documents where company_id = '${HUB}' and storage_path = '${HUB}/third.pdf' returning id` },
    status,
    { as: null, sql: needed },
  ]);
  const [before, , , taken, back, afterwards] = removed;
  report.check(
    '(the last paper waiting removed by the database: back to unverified)',
    taken.rows.length === 1 && back.rows[0]?.status === 'unverified',
    JSON.stringify(taken.rows) + (taken.error ?? '') + JSON.stringify(back.rows[0]),
  );
  report.check(
    'and that tells the company nothing: no reviewer asked it for anything',
    afterwards.rows[0]?.n === before.rows[0]?.n,
    `${before.rows[0]?.n} → ${afterwards.rows[0]?.n}`,
  );

  // The company's own: refused, as since migration 44 — and so not a way back
  // from a refusal to "unverified" (a paper sent, then taken back).
  const own = await scenario([...submit('fourth'), {
    as: E2,
    sql: `delete from company_documents where company_id = '${HUB}' and storage_path = '${HUB}/fourth.pdf' returning id`,
  }, status]);
  const [, , ownTake, ownStatus] = own;
  report.check(
    "a company cannot take its last paper waiting back out of the queue",
    !ownTake.ok && ownStatus.rows[0]?.status === 'pending',
    JSON.stringify(ownTake.rows) + (ownTake.error ?? '') + JSON.stringify(ownStatus.rows[0]),
  );
}

report.section('a verification taken away rings the bell (348)');
{
  const revoked = `select count(*)::int as n from notifications
                    where user_id = '${employerVerified}' and kind = 'company_verification_revoked'`;
  const status = { as: null, sql: `select verification_status::text as status from companies where id = '${company}'` };
  const results = await scenario([
    { as: null, sql: revoked },
    status,
    { as: admin, sql: `select admin_review_company('${company}', 'revoke', 'سجل تجاري منتهي — داخلي') as status` },
    { as: null, sql: revoked },
    {
      as: employerVerified,
      sql: `select payload, href from notifications
             where user_id = '${employerVerified}' and kind = 'company_verification_revoked'
             order by created_at desc limit 1`,
    },
    { as: admin, sql: `select admin_review_company('${company}', 'verify') as status` },
    { as: admin, sql: `select admin_review_company('${company}', 'revoke', 'تعارض في البيانات') as status` },
    { as: null, sql: revoked },
  ]);
  const [start, before, first, once, latest, verified, second, twice] = results;
  report.check(
    '(a verified company, and the reviewer revokes it)',
    before.rows[0]?.status === 'verified' && first.ok && first.rows[0]?.status === 'unverified',
    JSON.stringify(before.rows[0]) + (first.error ?? ''),
  );
  report.check("its members hear it in the bell", once.rows[0]?.n === start.rows[0]?.n + 1, `${start.rows[0]?.n} → ${once.rows[0]?.n}`);
  const notice = latest.rows[0];
  report.check(
    "naming the company and pointing at its page, not quoting the reviewer's reason",
    Boolean(notice?.payload?.name_ar) && notice?.href === '/employer/company' && !JSON.stringify(notice?.payload ?? {}).includes('داخلي'),
    JSON.stringify(notice ?? latest.error),
  );
  report.check(
    'verified again and revoked again, it is told again',
    verified.ok && second.ok && twice.rows[0]?.n === start.rows[0]?.n + 2,
    `${once.rows[0]?.n} → ${twice.rows[0]?.n} ${verified.error ?? ''} ${second.error ?? ''}`,
  );

  // The database itself moving a verified company back (no reviewer): not a
  // decision, so not told as one.
  const quiet = await scenario([
    { as: null, sql: revoked },
    { as: null, sql: `update companies set verification_status = 'unverified' where id = '${company}' returning id` },
    { as: null, sql: revoked },
  ]);
  const [quietBefore, moved, quietAfter] = quiet;
  report.check(
    'the database unverifying a company on its own tells it nothing',
    moved.rows.length === 1 && quietAfter.rows[0]?.n === quietBefore.rows[0]?.n,
    `${quietBefore.rows[0]?.n} → ${quietAfter.rows[0]?.n} ${moved.error ?? ''}`,
  );
}

report.section('the profile reminder lists those who asked and have not been told');
{
  const person = (n, nudge, days) => {
    const id = `99999999-9999-4999-8999-${String(n).padStart(12, '0')}`;
    return {
      id,
      steps: [
        { as: null, sql: `insert into auth.users (id, email) values ('${id}', 'nudge-${n}@demo.test')` },
        {
          as: null,
          sql: `insert into profiles (id, role, full_name, whatsapp_phone, notify_profile_nudge, created_at)
                values ('${id}', 'candidate', 'مرشح', '+2011${String(n).padStart(8, '0')}', ${nudge}, now() - interval '${days} days')`,
        },
      ],
    };
  };
  // The two who would be skipped signed up first, so a list in sign-up order
  // that does not leave them out hands them the run's places.
  const silent = person(1, false, 10);
  const told = person(2, true, 9);
  const waiting = person(3, true, 5);

  const results = await scenario([
    ...silent.steps,
    ...told.steps,
    ...waiting.steps,
    {
      as: null,
      sql: `insert into email_log (template, recipient, user_id, status, dedupe_key)
            values ('profile_incomplete', 'nudge-2@demo.test', '${told.id}', 'sent', 'profile_incomplete:${told.id}')`,
    },
    { as: null, sql: `select user_id from incomplete_candidate_profiles(200)` },
    { as: null, sql: `select user_id from incomplete_candidate_profiles(1)` },
  ]);
  const setup = results.slice(0, -2);
  report.check('(three people who signed up days ago, one already reminded)', setup.every((step) => step.ok), JSON.stringify(setup.find((step) => !step.ok)));
  const [listed, first] = results.slice(-2);
  const ids = new Set(listed.rows.map((row) => row.user_id));
  report.check('somebody who asked and has not been reminded is listed', ids.has(waiting.id), listed.error);
  report.check('somebody who did not ask is not', !ids.has(silent.id));
  report.check('nor somebody who has already been told — the email would be refused', !ids.has(told.id));
  report.check(
    'so a run with one place reaches the person waiting for it',
    first.rows.length === 1 && first.rows[0].user_id === waiting.id,
    JSON.stringify(first.rows),
  );
}

await db.close?.();
process.exitCode = report.finish() ? 0 : 1;
