/**
 * Pushes as the person chose (migration 335), against the real migrations.
 * Run with: pnpm test:push  (also part of pnpm test:db)
 *
 * What is pinned: which switch every kind answers to; quiet hours, by Cairo's
 * wall clock in summer and in winter, and the expiry notices' own window kept
 * either way; a kind turned off not queued while the bell still has it; the
 * choice asked again when a push is handed out to be sent (a retry in the
 * night held, a kind switched off since skipped — migration 341); the
 * defaults being today's behaviour; and only the person changing their own
 * switches.
 */
import { createTestDb, runner, reporter, FIXTURES } from './setup.mjs';

const report = reporter();
const db = await createTestDb();
const as = runner(db);

const { candidate, employerVerified } = FIXTURES;
const PHONE = 'ExponentPushToken[dddddddddddddddddddddd]';

const one = async (sql) => (await db.query(sql)).rows[0];
const count = async (sql) => Number((await db.query(sql)).rows[0].n);

/** As the senders call it: the service role, committed. */
async function asCommit(sql) {
  await db.exec('begin');
  try {
    await db.exec(`set local role service_role;`);
    await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'service_role' })}';`);
    const result = await db.query(sql);
    await db.exec('commit');
    return { ok: true, rows: result.rows };
  } catch (error) {
    await db.exec('rollback');
    return { ok: false, error: error.message, rows: [] };
  }
}

report.section('which switch a kind answers to');
{
  const kinds = (await db.query(`select unnest(enum_range(null::notification_kind))::text as kind`)).rows.map((row) => row.kind);
  const category = async (kind) => (await one(`select public.push_category('${kind}') as c`)).c;
  report.check('the new listings are job alerts', (await category('new_jobs')) === 'job_alerts');
  const applications = ['application_submitted', 'application_received', 'application_withdrawn', 'application_moved'];
  report.check('the four application events are applications',
    (await Promise.all(applications.map(category))).every((c) => c === 'applications'));
  const rest = kinds.filter((kind) => kind !== 'new_jobs' && !applications.includes(kind));
  report.check(`every other kind (${rest.length}) is the account's`,
    rest.length > 10 && (await Promise.all(rest.map(category))).every((c) => c === 'account'));
}

report.section('when a push may go');
{
  // Cairo is UTC+3 in summer (October 1st) and UTC+2 in winter (December 1st).
  const hold = async (kind, at, quiet) =>
    (await one(`select to_char(public.push_hold_until('${kind}', '${at}'::timestamptz, ${quiet}) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as t`)).t;

  report.check('without quiet hours, nothing waits', (await hold('application_moved', '2026-10-01 23:30:00+00', false)) === '2026-10-01 23:30');
  report.check('nor when the person has no choice recorded', (await hold('application_moved', '2026-10-01 23:30:00+00', 'null')) === '2026-10-01 23:30');
  report.check('quiet hours: 22:59 in Cairo goes at once',
    (await hold('application_moved', '2026-10-01 22:59:00+03', true)) === '2026-10-01 19:59');
  report.check('11 pm in Cairo waits for eight the next morning',
    (await hold('application_moved', '2026-10-01 23:00:00+03', true)) === '2026-10-02 05:00');
  report.check('3 am waits for eight the same morning',
    (await hold('application_moved', '2026-10-02 03:00:00+03', true)) === '2026-10-02 05:00');
  report.check('eight o’clock goes at once',
    (await hold('application_moved', '2026-10-02 08:00:00+03', true)) === '2026-10-02 05:00');
  report.check('in winter, eight in Cairo is six UTC',
    (await hold('new_jobs', '2026-12-01 23:30:00+02', true)) === '2026-12-02 06:00');
  report.check('the expiry notices keep their daytime window with quiet hours off',
    (await hold('job_expiring', '2026-10-02 06:00:00+03', false)) === '2026-10-02 06:00');
  report.check('and with them on', (await hold('job_expiring', '2026-10-02 06:00:00+03', true)) === '2026-10-02 06:00');
}

report.section('what is queued');
{
  await db.exec('begin');
  await db.exec(`set local role authenticated;`);
  await db.exec(`set local request.jwt.claim.sub = '${candidate}';`);
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: candidate })}';`);
  await db.query(`select public.register_push_device('${PHONE}', 'ios', 'ar', '1.0.0')`);
  await db.exec('commit');

  const defaults = await one(`select push_job_alerts, push_applications, push_account, push_quiet_hours from profiles where id = '${candidate}'`);
  report.check('the defaults are today’s behaviour: every kind on, no quiet hours',
    defaults.push_job_alerts && defaults.push_applications && defaults.push_account && !defaults.push_quiet_hours);

  /** A notification as the triggers write one; whether a push was queued for it, and when. */
  async function notified(kind, createdAt = 'now()') {
    const id = (await one(`insert into notifications (user_id, kind, payload, created_at)
                           values ('${candidate}', '${kind}', '{"count":1}', ${createdAt}) returning id`)).id;
    const queued = await one(`select next_attempt_at from push_outbox where notification_id = '${id}'`);
    const inBell = await count(`select count(*)::int as n from notifications where id = '${id}'`);
    return { queued: Boolean(queued), at: queued?.next_attempt_at ?? null, inBell: inBell === 1 };
  }

  report.check('with everything on, each kind is queued',
    (await notified('new_jobs')).queued && (await notified('application_moved')).queued && (await notified('support_replied')).queued);

  await db.exec(`update profiles set push_job_alerts = false where id = '${candidate}'`);
  const alerts = await notified('new_jobs');
  report.check('new listings turned off: not queued, still in the bell', !alerts.queued && alerts.inBell);
  report.check('and the others still are', (await notified('application_moved')).queued);

  await db.exec(`update profiles set push_applications = false where id = '${candidate}'`);
  report.check('applications turned off: not queued', !(await notified('application_moved')).queued);
  await db.exec(`update profiles set push_account = false where id = '${candidate}'`);
  report.check('the account turned off: not queued', !(await notified('password_changed')).queued);

  await db.exec(`update profiles set push_job_alerts = true, push_applications = true, push_account = true, push_quiet_hours = true where id = '${candidate}'`);
  const night = await notified('application_moved', `'2026-10-02 02:30:00+03'`);
  report.check('quiet hours: a push made at 2:30 in Cairo is queued for eight',
    night.queued && new Date(night.at).toISOString() === '2026-10-02T05:00:00.000Z', String(night.at));

  await db.exec(`update profiles set push_quiet_hours = false where id = '${candidate}'`);
}

report.section('asked again when it goes (migration 341)');
{
  // The phone registered above; quiet hours on, every kind on.
  await db.exec(`update profiles set push_job_alerts = true, push_applications = true, push_account = true, push_quiet_hours = true where id = '${candidate}'`);
  const id = (await one(`insert into notifications (user_id, kind, payload) values ('${candidate}', 'application_moved', '{"count":1}') returning id`)).id;
  const outbox = (await one(`select id from push_outbox where notification_id = '${id}'`)).id;
  const dueAt = async (at) =>
    (await one(`select to_char(public.push_due_at(${outbox}, '${at}'::timestamptz) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as t`)).t;

  report.check('a retry that comes due after midnight in Cairo waits for eight',
    (await dueAt('2026-10-02 00:06:00+03')) === '2026-10-02 05:00');
  report.check('one that comes due in the day goes then', (await dueAt('2026-10-02 14:00:00+03')) === '2026-10-02 11:00');
  await db.exec(`update profiles set push_quiet_hours = false where id = '${candidate}'`);
  report.check('quiet hours turned off since: it goes when it comes due', (await dueAt('2026-10-02 00:06:00+03')) === '2026-10-01 21:06');
  await db.exec(`update profiles set push_applications = false where id = '${candidate}'`);
  report.check('its kind switched off since: it does not go at all', (await dueAt('2026-10-02 14:00:00+03')) === null);

  // Through the lease the senders use: due now, switched off since it was queued.
  await db.exec(`update push_outbox set next_attempt_at = now() - interval '1 minute' where id = ${outbox}`);
  const leased = await asCommit(`select * from public.lease_due_pushes(10, 60)`);
  report.check('the senders are not handed it', leased.ok && !leased.rows.some((row) => Number(row.id) === Number(outbox)), leased.error);
  const settled = await one(`select status, detail, settled_at is not null as settled from push_outbox where id = ${outbox}`);
  report.check('it is settled as skipped, saying why',
    settled.status === 'skipped' && settled.detail === 'switched off' && settled.settled, JSON.stringify(settled));

  // Switched back on, with quiet hours: whatever the hour this runs at, it is
  // handed out now unless Cairo is in the night, and then it waits for eight.
  await db.exec(`update profiles set push_applications = true, push_quiet_hours = true where id = '${candidate}'`);
  const id2 = (await one(`insert into notifications (user_id, kind, payload) values ('${candidate}', 'application_moved', '{"count":2}') returning id`)).id;
  const outbox2 = (await one(`select id from push_outbox where notification_id = '${id2}'`)).id;
  await db.exec(`update push_outbox set next_attempt_at = now() - interval '1 minute' where id = ${outbox2}`);
  const night = (await one(`select public.push_hold_until('application_moved', now(), true) > now() as night`)).night;
  const lease2 = await asCommit(`select * from public.lease_due_pushes(10, 60)`);
  const handed = lease2.rows.some((row) => Number(row.id) === Number(outbox2));
  const row2 = await one(`select status, next_attempt_at > now() as later from push_outbox where id = ${outbox2}`);
  report.check(night ? 'at night in Cairo: held for eight, still queued' : 'in the day in Cairo: handed out at once',
    night ? !handed && row2.status === 'queued' && row2.later : handed, JSON.stringify({ night, handed, row2 }));
  await db.exec(`update profiles set push_quiet_hours = false where id = '${candidate}'`);
}

report.section('whose switches');
{
  const own = await as(candidate, `update profiles set push_job_alerts = false, push_quiet_hours = true where id = '${candidate}' returning id`);
  report.check('a person sets their own', own.ok && own.rows.length === 1, own.error);
  const other = await as(employerVerified, `update profiles set push_account = false where id = '${candidate}' returning id`);
  report.check('nobody sets somebody else’s', other.ok && other.rows.length === 0, other.error);
  const smuggled = await as(candidate, `update profiles set push_account = false, role = 'admin' where id = '${candidate}'`);
  report.check('and a role change still cannot ride along with them', !smuggled.ok, smuggled.error);
}

process.exit(report.finish() ? 0 : 1);
