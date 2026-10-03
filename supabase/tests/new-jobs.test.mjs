/**
 * The day's new-jobs notification (migrations 333–334), against the real
 * migrations.
 * Run with: pnpm test:new-jobs  (also part of pnpm test:db)
 *
 * What is pinned: only the service role writes it; one per person per Cairo
 * day, whoever calls and however often; only to a candidate; never empty; a
 * phone hears of it like any notification; and the daily job's cursor is the
 * job's alone.
 */
import { createTestDb, runner, reporter, FIXTURES } from './setup.mjs';

const report = reporter();
const db = await createTestDb();
const as = runner(db);

const { candidate, publicAgent, employerVerified } = FIXTURES;
const PHONE = 'ExponentPushToken[cccccccccccccccccccccc]';
const PAYLOAD = JSON.stringify({ count: 2, source: 'mixed' });

const one = async (sql) => (await db.query(sql)).rows[0];
const count = async (sql) => Number((await db.query(sql)).rows[0].n);
const record = (user, payload = PAYLOAD, href = '/dashboard/saved') =>
  `select public.record_new_jobs_notification('${user}', '${payload}'::jsonb, '${href}') as id`;

report.section('who may write it');
{
  const anon = await as(null, record(candidate), 'anon');
  report.check('not somebody signed out', !anon.ok, anon.error);
  const self = await as(candidate, record(candidate));
  report.check('not even the person it is for', !self.ok, self.error);
  const service = await as(null, record(candidate), 'service_role');
  report.check('the service role (the daily job) may', service.ok && Boolean(service.rows[0]?.id), service.error);
}

report.section('once a day');
{
  const first = await one(record(candidate));
  report.check('the first of the day is written, and its id returned', Boolean(first.id));
  const row = await one(`select kind, payload, href, dedupe_key, read_at from notifications where id = '${first.id}'`);
  const today = (await one(`select to_char((now() at time zone 'Africa/Cairo')::date, 'YYYY-MM-DD') as d`)).d;
  report.check('as a new_jobs notification, unread, where the job pointed it',
    row.kind === 'new_jobs' && row.read_at === null && row.href === '/dashboard/saved' && row.payload.count === 2);
  report.check("keyed to the Cairo date", row.dedupe_key === `new_jobs:${today}`, row.dedupe_key);

  const second = await one(record(candidate, JSON.stringify({ count: 5, source: 'search', label: 'x' }), '/jobs?track=primary'));
  report.check('a second the same day writes nothing and says so', second.id === null);
  report.check('and the first is left as it was',
    (await count(`select count(*)::int as n from notifications where user_id = '${candidate}' and kind = 'new_jobs'`)) === 1 &&
      (await one(`select payload from notifications where id = '${first.id}'`)).payload.count === 2);

  const other = await one(record(publicAgent));
  report.check('another person has their own', Boolean(other.id) && other.id !== first.id);
}

report.section('only what it is for');
{
  const employer = await one(record(employerVerified));
  report.check('nobody but a candidate is told about jobs', employer.id === null &&
    (await count(`select count(*)::int as n from notifications where user_id = '${employerVerified}' and kind = 'new_jobs'`)) === 0);

  for (const [label, payload] of [
    ['a count of nothing', JSON.stringify({ count: 0, source: 'mixed' })],
    ['no count at all', JSON.stringify({ source: 'mixed' })],
    ['a count that is not a number', JSON.stringify({ count: 'two', source: 'mixed' })],
    ['a payload that is not an object', JSON.stringify([1])],
  ]) {
    const refused = await as(null, record(candidate, payload), 'service_role');
    report.check(`${label} is refused`, !refused.ok, refused.error);
  }
}

report.section('a phone hears of it');
{
  // A fresh person for this: the candidate's notice for today is already written.
  await db.exec(`delete from notifications where user_id = '${publicAgent}' and kind = 'new_jobs'`);
  await db.exec('begin');
  await db.exec(`set local role authenticated;`);
  await db.exec(`set local request.jwt.claim.sub = '${publicAgent}';`);
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: publicAgent })}';`);
  await db.query(`select public.register_push_device('${PHONE}', 'ios', 'ar', '1.0.0')`);
  await db.exec('commit');

  const told = await one(record(publicAgent));
  report.check('a push is queued for somebody with a phone',
    (await count(`select count(*)::int as n from push_outbox where notification_id = '${told.id}'`)) === 1);
}

report.section("the daily job's cursor");
{
  await db.exec('begin');
  await db.exec(`set local role authenticated;`);
  await db.exec(`set local request.jwt.claim.sub = '${candidate}';`);
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: candidate })}';`);
  const saved = (
    await db.query(`insert into saved_searches (candidate_id, label, query) values ('${candidate}', 'بيع أول', 'track=primary') returning id`)
  ).rows[0].id;
  await db.exec('commit');

  const owner = await as(candidate, `update saved_searches set bell_checked_at = now() where id = '${saved}'`);
  report.check('its owner cannot move it', !owner.ok && /bell_checked_at/.test(owner.error ?? ''), owner.error);
  const rename = await as(candidate, `update saved_searches set label = 'بيع أول — التجمع' where id = '${saved}' returning label`);
  report.check('though they may still rename their search', rename.ok && rename.rows.length === 1, rename.error);
  const job = await as(null, `update saved_searches set bell_checked_at = now() where id = '${saved}' returning bell_checked_at`, 'service_role');
  report.check('the job moves it', job.ok && job.rows[0]?.bell_checked_at !== null, job.error);
  const weekly = await as(candidate, `update saved_searches set last_checked_at = now() where id = '${saved}'`);
  report.check("and the weekly email's cursor is still guarded as before", !weekly.ok, weekly.error);
}

process.exit(report.finish() ? 0 : 1);
