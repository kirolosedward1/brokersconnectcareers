/**
 * Pushes to phones (migration 329), against the real migrations.
 * Run with: pnpm test:push  (also part of pnpm test:db)
 *
 * What is pinned: who can register a phone and read it; a token moving to
 * whoever signs in on the phone; what gets queued — a notification for
 * somebody with a phone, unread and not folded, once — and what does not;
 * quiet hours for the routine kinds; the sender's lease, settle, backoff and
 * give-up; the stale and the crashing; that a broken queue never costs the
 * notification; and that nobody but the service role touches the outbox.
 */
import { createTestDb, runner, reporter, FIXTURES } from './setup.mjs';

const report = reporter();
const db = await createTestDb();
const as = runner(db);

const { candidate, employerVerified, publicAgent } = FIXTURES;
const PHONE = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const OTHER_PHONE = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

/** Like `as`, but commits — for writes a later assertion needs to see. */
async function asCommit(userId, sql, role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role};`);
    if (userId) await db.exec(`set local request.jwt.claim.sub = '${userId}';`);
    await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role, ...(userId ? { sub: userId } : {}) })}';`);
    const result = await db.query(sql);
    await db.exec('commit');
    return { ok: true, rows: result.rows };
  } catch (error) {
    await db.exec('rollback');
    return { ok: false, error: error.message, rows: [] };
  }
}

const one = async (sql) => (await db.query(sql)).rows[0];
const count = async (sql) => Number((await db.query(sql)).rows[0].n);

/** A notification written the way the triggers write one. */
async function notify(userId, kind = 'application_moved', extra = '') {
  return (
    await one(`insert into notifications (user_id, kind, payload ${extra ? `, ${extra.split('=')[0]}` : ''})
               values ('${userId}', '${kind}', '{"title_ar":"وظيفة"}' ${extra ? `, ${extra.split('=')[1]}` : ''})
               returning id`)
  ).id;
}

const queuedFor = (notificationId) =>
  count(`select count(*)::int as n from push_outbox where notification_id = '${notificationId}'`);

report.section('registering a phone');
{
  const anon = await as(null, `select public.register_push_device('${PHONE}', 'ios', 'ar', '1.0.0')`, 'anon');
  report.check('nobody signed out can register one', !anon.ok, anon.error);

  const bad = await as(candidate, `select public.register_push_device('not-a-token', 'ios', 'ar', '1.0.0')`);
  report.check('a token that is not an Expo token is refused', !bad.ok, bad.error);

  const odd = await as(candidate, `select public.register_push_device('${PHONE}', 'windows', 'ar', '1.0.0')`);
  report.check('so is a platform the app does not run on', !odd.ok, odd.error);

  const mine = await asCommit(candidate, `select public.register_push_device('${PHONE}', 'ios', 'ar', '1.0.0') as id`);
  report.check('a signed-in person registers their phone', mine.ok && Boolean(mine.rows[0]?.id), mine.error);

  const again = await asCommit(candidate, `select public.register_push_device('${PHONE}', 'ios', 'en', '1.0.1') as id`);
  report.check('registering again is the same row, brought up to date',
    again.ok && again.rows[0].id === mine.rows[0].id &&
      (await one(`select locale, app_version from push_devices where token = '${PHONE}'`)).locale === 'en');

  const theirs = await as(candidate, `select token from push_devices`);
  report.check('its owner can read it', theirs.ok && theirs.rows.length === 1);
  const others = await as(employerVerified, `select token from push_devices`);
  report.check('nobody else can', others.ok && others.rows.length === 0);

  const direct = await as(candidate, `insert into push_devices (user_id, token, platform) values ('${candidate}', '${OTHER_PHONE}', 'ios')`);
  report.check('and nobody writes the table directly', !direct.ok, direct.error);

  const moved = await asCommit(publicAgent, `select public.register_push_device('${PHONE}', 'ios', 'ar', '1.0.0')`);
  report.check('signing in as somebody else on the same phone moves it to them',
    moved.ok && (await one(`select user_id from push_devices where token = '${PHONE}'`)).user_id === publicAgent);

  // Back to the candidate, for what follows.
  await asCommit(candidate, `select public.register_push_device('${PHONE}', 'ios', 'ar', '1.0.0')`);

  const forget = await asCommit(employerVerified, `select public.unregister_push_device('${PHONE}')`);
  report.check("unregistering somebody else's phone does nothing",
    forget.ok && (await count(`select count(*)::int as n from push_devices where token = '${PHONE}'`)) === 1);
}

report.section('what is queued');
{
  const withoutPhone = await notify(employerVerified);
  report.check('nothing for somebody with no phone', (await queuedFor(withoutPhone)) === 0);

  const withPhone = await notify(candidate);
  report.check('one push for somebody with a phone', (await queuedFor(withPhone)) === 1);

  const read = await notify(candidate, 'application_moved', 'read_at=now()');
  report.check('nothing for a notification written already read', (await queuedFor(read)) === 0);

  // An applicant flood, from the applications trigger: one bell row, one push.
  // The employer has read everything so far, so the first applicant starts a
  // new row rather than folding into one the seed left unread.
  await asCommit(employerVerified, `select public.register_push_device('${OTHER_PHONE}', 'ios', 'ar', '1.0.0')`);
  await db.exec(`update notifications set read_at = now() where user_id = '${employerVerified}' and read_at is null`);
  const company = (await one(`select company_id from company_members where user_id = '${employerVerified}' and role = 'admin' limit 1`)).company_id;
  const job = (await one(`select id from jobs where company_id = '${company}' and status = 'active' and expires_at > now() order by id limit 1`)).id;
  const applicants = [
    '91111111-1111-4111-8111-111111111111',
    '92222222-2222-4222-8222-222222222222',
    '93333333-3333-4333-8333-333333333333',
  ];
  for (const [index, id] of applicants.entries()) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', 'flood${index}@demo.test');
      insert into profiles (id, role, full_name, whatsapp_phone) values ('${id}', 'candidate', 'متقدم', '+20100000000${index}');
      insert into applications (job_id, candidate_id, status) values ('${job}', '${id}', 'new');
    `);
  }
  const pushes = await count(`select count(*)::int as n from push_outbox o join notifications n on n.id = o.notification_id
                               where n.user_id = '${employerVerified}' and n.kind = 'application_received'`);
  report.check('three applicants to one listing are one push to the employer, as they are one row', pushes === 1, String(pushes));

  await asCommit(publicAgent, `select public.register_push_device('ExponentPushToken[switchedoffaaaaaaaaaaa]', 'ios', 'ar', '1.0.0')`);
  await db.exec(`update push_devices set disabled_at = now(), disabled_reason = 'DeviceNotRegistered' where user_id = '${publicAgent}'`);
  const disabled = await notify(publicAgent);
  report.check('nothing for a phone that has been switched off', (await queuedFor(disabled)) === 0);
}

report.section('quiet hours');
{
  const at = async (kind, cairo) =>
    (await one(`select to_char(public.push_not_before('${kind}', timestamptz '${cairo} Africa/Cairo') at time zone 'Africa/Cairo',
                               'YYYY-MM-DD HH24:MI') as t`)).t;
  report.check('an expiry notice from the 3 a.m. sweep waits until nine',
    (await at('job_expiring', '2026-10-05 03:10')) === '2026-10-05 09:00');
  report.check('one written late in the evening waits until nine the next day',
    (await at('job_expired', '2026-10-05 22:30')) === '2026-10-06 09:00');
  report.check('one written in the day goes at once',
    (await at('job_expiring', '2026-10-05 13:45')) === '2026-10-05 13:45');
  report.check('anything about an application goes at once, whatever the hour',
    (await at('application_moved', '2026-10-05 03:10')) === '2026-10-05 03:10');
}

report.section('a broken queue never costs the notification');
{
  // Every insert into the outbox now fails.
  await db.exec(`alter table push_outbox add constraint push_outbox_broken check (false) not valid`);
  let written = null;
  try {
    written = await notify(candidate);
  } catch {
    written = null;
  }
  await db.exec(`alter table push_outbox drop constraint push_outbox_broken`);
  report.check('the notification is written', Boolean(written));
  report.check('and only the push is lost', written !== null && (await queuedFor(written)) === 0);
}

report.section('the sender');
{
  const noLease = await as(candidate, `select * from public.lease_due_pushes(10, 60)`);
  report.check('a signed-in person cannot lease pushes', !noLease.ok, noLease.error);
  const noRead = await as(candidate, `select count(*)::int as n from push_outbox`);
  report.check('nor read the outbox', noRead.ok && noRead.rows[0].n === 0);

  // A clean queue: one row, due now.
  await db.exec(`delete from push_outbox`);
  const target = await notify(candidate);

  const leased = await asCommit(null, `select * from public.lease_due_pushes(10, 60)`, 'service_role');
  report.check('the service role leases what is due', leased.ok && leased.rows.length === 1 && leased.rows[0].notification_id === target, leased.error);
  const token = leased.rows[0]?.lock_token;

  const twice = await asCommit(null, `select * from public.lease_due_pushes(10, 60)`, 'service_role');
  report.check('a second sweeper does not get the same row', twice.ok && twice.rows.length === 0);

  const wrong = await asCommit(null, `select public.settle_push(${leased.rows[0].id}, gen_random_uuid(), 'sent') as ok`, 'service_role');
  report.check('settling without the lease does nothing', wrong.ok && wrong.rows[0].ok === false);

  const retry = await asCommit(null, `select public.settle_push(${leased.rows[0].id}, '${token}', 'retry', 'Expo 503') as ok`, 'service_role');
  const after = await one(`select status, attempts, next_attempt_at > now() + interval '50 seconds' as later, lock_token from push_outbox where id = ${leased.rows[0].id}`);
  report.check('a retry goes back in the queue, a minute later, with the lease let go',
    retry.rows[0].ok && after.status === 'queued' && after.attempts === 1 && after.later && after.lock_token === null);

  const bogus = await as(null, `select public.settle_push(${leased.rows[0].id}, '${token}', 'maybe')`, 'service_role');
  report.check('an outcome it does not know is refused', !bogus.ok);

  // Four more tries, each made due at once: the fifth is the last.
  for (let attempt = 2; attempt <= 5; attempt += 1) {
    await db.exec(`update push_outbox set next_attempt_at = now() - interval '1 second' where id = ${leased.rows[0].id}`);
    const again = await asCommit(null, `select * from public.lease_due_pushes(10, 60)`, 'service_role');
    await asCommit(null, `select public.settle_push(${again.rows[0].id}, '${again.rows[0].lock_token}', 'retry', 'Expo 503')`, 'service_role');
  }
  const gaveUp = await one(`select status, attempts, settled_at is not null as settled from push_outbox where id = ${leased.rows[0].id}`);
  report.check('five tries, and then it is given up', gaveUp.status === 'failed' && gaveUp.attempts === 5 && gaveUp.settled, JSON.stringify(gaveUp));

  const sentFor = await notify(candidate);
  const lease = await asCommit(null, `select * from public.lease_due_pushes(10, 60)`, 'service_role');
  const sent = await asCommit(null, `select public.settle_push(${lease.rows[0].id}, '${lease.rows[0].lock_token}', 'sent') as ok`, 'service_role');
  report.check('a sent push is settled once',
    sent.rows[0].ok && (await one(`select status from push_outbox where notification_id = '${sentFor}'`)).status === 'sent');

  const stale = await notify(candidate);
  await db.exec(`update push_outbox set created_at = now() - interval '2 days' where notification_id = '${stale}'`);
  const crashing = await notify(candidate);
  await db.exec(`update push_outbox set leases = 8 where notification_id = '${crashing}'`);
  const swept = await asCommit(null, `select * from public.lease_due_pushes(10, 60)`, 'service_role');
  const staleRow = await one(`select status, detail from push_outbox where notification_id = '${stale}'`);
  const crashRow = await one(`select status, detail from push_outbox where notification_id = '${crashing}'`);
  report.check('a push a day old is not sent late', staleRow.status === 'failed' && staleRow.detail === 'expired' &&
    !swept.rows.some((row) => row.notification_id === stale));
  report.check('nor one that has crashed its worker eight times', crashRow.status === 'failed' && crashRow.detail === 'leased too often');
}

report.section('housekeeping');
{
  await db.exec(`update push_outbox set settled_at = now() - interval '40 days' where status <> 'queued'`);
  const device = (await one(`select id from push_devices where token = '${PHONE}'`)).id;
  await db.exec(`insert into push_tickets (ticket_id, device_id, created_at) values
                   ('old-ticket', '${device}', now() - interval '3 days'),
                   ('new-ticket', '${device}', now())`);
  const pruned = await asCommit(null, `select public.prune_push_outbox(1000) as n`, 'service_role');
  report.check('settled rows after thirty days, and receipts Expo no longer keeps, are pruned',
    pruned.ok && pruned.rows[0].n > 0 &&
      (await count(`select count(*)::int as n from push_outbox where status <> 'queued' and settled_at < now() - interval '30 days'`)) === 0 &&
      (await count(`select count(*)::int as n from push_tickets`)) === 1);

  // Eleven phones: the one unseen longest stops.
  for (let n = 0; n < 11; n += 1) {
    await db.exec(`update push_devices set last_seen_at = now() - interval '1 hour' where user_id = '${employerVerified}'`);
    await asCommit(employerVerified, `select public.register_push_device('ExponentPushToken[phone${String(n).padStart(2, '0')}aaaaaaaaaaaa]', 'ios', 'ar', '1.0.0')`);
  }
  const active = await count(`select count(*)::int as n from push_devices where user_id = '${employerVerified}' and disabled_at is null`);
  report.check('past ten phones, the one unseen longest stops', active === 10, String(active));
}

report.section('a deleted account takes its phones with it');
{
  const id = '88888888-8888-4888-8888-888888888888';
  await db.exec(`
    insert into auth.users (id, email) values ('${id}', 'leaving@demo.test');
    insert into profiles (id, role, full_name, whatsapp_phone) values ('${id}', 'candidate', 'مغادر', '+201888888888');
  `);
  await asCommit(id, `select public.register_push_device('ExponentPushToken[leavingaaaaaaaaaaaaaaa]', 'ios', 'ar', '1.0.0')`);
  await db.exec(`delete from auth.users where id = '${id}'`);
  report.check('no phone is left behind', (await count(`select count(*)::int as n from push_devices where user_id = '${id}'`)) === 0);
}

process.exit(report.finish() ? 0 : 1);
