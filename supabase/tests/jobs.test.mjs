/**
 * Background work, against the real schema: the outbox's retry machinery and
 * the scheduled jobs' lock.
 *
 * Everything here runs with nobody watching, which is why it is tested by
 * scenario rather than by function. Each section is one of the ways a bad day
 * actually goes — a worker dies mid-send, a provider is down for an afternoon,
 * Vercel fires the same cron twice, a nightly run never happens — and asserts
 * what the database leaves behind afterwards. A function that "works" but
 * leaves a row locked, retried forever or silently dropped is exactly the
 * failure these rows exist to prevent, and only the row can show it.
 *
 * PGlite is one connection, so "two workers" here means two workers taking
 * turns. The genuinely concurrent versions — two transactions racing for the
 * same row on a real server — are in concurrency.test.mjs.
 *
 * Time is moved by editing the row rather than by waiting: a lease "expires"
 * when locked_until is set into the past, a run is "missed" when expires_at
 * already is. Every other value is what the functions wrote.
 *
 * Run with: pnpm test:jobs
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { createTestDb, reporter, runner, testDbScripts, USERS } from './setup.mjs';

const base = reporter();
const report = {
  ...base,
  is(actual, expected, label) {
    base.check(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  },
  ok(condition, label, detail = '') {
    base.check(label, Boolean(condition), detail);
  },
};

const db = await createTestDb();
const as = runner(db);

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];

/**
 * Like runner(), but commits: for the admin actions whose effect the next
 * assertion has to see.
 */
async function asCommitted(userId, sql, role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role};`);
    await db.exec(`set local request.jwt.claim.sub = '${userId}';`);
    await db.exec(`set local request.jwt.claims = '{"role":"${role}","sub":"${userId}"}';`);
    const result = await db.query(sql);
    await db.exec('commit');
    return { ok: true, rows: result.rows };
  } catch (error) {
    await db.exec('rollback');
    return { ok: false, error: error.message, rows: [] };
  }
}

const RECIPIENT = 'someone@brokersconnect.net';

async function claim(key, { token = null, to = RECIPIENT, template = 'application_status', entity = null } = {}) {
  const row = await one(
    'select public.claim_email($1, $2, $3, null, $4, $5, $6) as id',
    [key, template, to, entity ? 'application' : null, entity, token],
  );
  return row.id;
}

const row = (id) => one('select * from email_log where id = $1', [id]);

/**
 * Pushes every live row far into the future, so the lease in the next section
 * sees only the rows that section made due. Sections share one database and
 * lease_due_emails takes whatever is due, which is the point of it.
 */
const park = () =>
  db.query(
    `update email_log set next_attempt_at = now() + interval '30 days'
      where status in ('queued', 'failed') and gave_up_at is null`,
  );

const makeDue = (id) =>
  db.query(`update email_log set next_attempt_at = now() - interval '1 second' where id = $1`, [id]);

const lease = (limit = 25, seconds = 120) =>
  q('select * from public.lease_due_emails($1, $2)', [limit, seconds]);

const settle = async (id, token, outcome, detail = null) =>
  (await one('select public.settle_leased_email($1, $2, $3, $4) as ok', [id, token, outcome, detail])).ok;

const record = (id, status, { provider = null, error = null, exhaust = false } = {}) =>
  db.query('select public.record_email_attempt($1, $2, $3, $4, $5)', [id, status, provider, error, exhaust]);

// ---------------------------------------------------------------------------
// A freshly claimed row is the send path's, not the sweeper's
// ---------------------------------------------------------------------------

report.section('a new message is left to its own send for five minutes');
{
  await park();
  const id = await claim('grace:1');
  const r = await row(id);
  const ahead = (r.next_attempt_at - Date.now()) / 60000;
  report.ok(ahead > 4 && ahead <= 5.1, 'next_attempt_at defaults to about five minutes out', `got ${ahead.toFixed(2)} min`);
  report.is((await lease()).length, 0, 'the sweeper does not lease it during the grace, while after() may be sending it');
}

// ---------------------------------------------------------------------------
// Retry: backoff, the attempt cap, and the retry happening in place
// ---------------------------------------------------------------------------

report.section('retry: exponential backoff with jitter, then the dead letters at five');
{
  await park();
  const id = await claim('retry:backoff');
  const expectedMinutes = [10, 40, 160, 640];

  for (let n = 1; n <= 5; n += 1) {
    await makeDue(id);
    const leased = await lease();
    report.is(leased.length, 1, `attempt ${n}: the due row is leased`);
    const token = leased[0]?.lock_token;
    report.is(leased[0]?.id, id, `attempt ${n}: it is the original row, not a copy`);
    report.is(leased[0]?.attempts, n - 1, `attempt ${n}: the lease carries the attempts so far (${n - 1})`);

    // The composer re-runs and claims its key with the lease token: the same
    // row comes back, which is the whole of "retry in place".
    const again = await claim('retry:backoff', { token });
    report.is(again, id, `attempt ${n}: claim_email with the token hands back the same row`);

    await record(id, 'failed', { error: '503 upstream' });
    const after = await one(
      `select attempts, gave_up_at, next_attempt_at, lock_token, locked_until,
              extract(epoch from next_attempt_at - last_attempt_at)::float8 / 60 as wait
         from email_log where id = $1`,
      [id],
    );
    report.is(after.attempts, n, `attempt ${n}: attempts is the real count (${n})`);
    report.ok(after.lock_token === null && after.locked_until === null, `attempt ${n}: recording the attempt releases the lease`);

    if (n < 5) {
      const expected = expectedMinutes[n - 1];
      report.ok(
        after.wait >= expected * 0.8 - 0.01 && after.wait <= expected * 1.2 + 0.01,
        `attempt ${n}: next try in ${expected}m ±20% (got ${after.wait.toFixed(1)}m)`,
      );
      report.is(after.gave_up_at, null, `attempt ${n}: not given up yet`);
    } else {
      report.ok(after.gave_up_at !== null, 'attempt 5: given up — gave_up_at is stamped');
      report.is(after.next_attempt_at, null, 'attempt 5: and nothing is scheduled');
    }
  }

  const { n } = await one(`select count(*)::int as n from email_log where dedupe_key = 'retry:backoff'`);
  report.is(n, 1, 'five attempts, one row — no stranger rows claimed along the way');

  await makeDue(id);
  report.is((await lease()).length, 0, 'a dead letter is never leased again, however due it looks');

  const pending = await q('select id from public.pending_emails(100)');
  report.ok(!pending.some((p) => p.id === id), 'and pending_emails no longer lists it');
}

report.section('retry: the jitter is real, bounded and capped');
{
  const { lo, hi, distinct } = await one(
    `select min(d) as lo, max(d) as hi, count(distinct d)::int as distinct
       from (select extract(epoch from public.email_retry_delay(1))::float8 / 60 as d
               from generate_series(1, 300)) s`,
  );
  report.ok(lo >= 8 && hi <= 12, `300 first-retry delays all fall in 8–12 minutes (got ${lo.toFixed(2)}–${hi.toFixed(2)})`);
  report.ok(distinct > 50, 'and they differ — four hundred messages failed together do not retry together');

  const { cap } = await one(
    `select max(extract(epoch from public.email_retry_delay(20))::float8 / 3600) as cap
       from generate_series(1, 50)`,
  );
  report.ok(cap <= 12 * 1.2 + 0.001, `a far-out attempt is capped near twelve hours (got ${cap.toFixed(2)}h)`);
}

report.section('retry: a permanent failure is dead after one attempt');
{
  await park();
  const id = await claim('retry:permanent');
  await record(id, 'failed', { error: '422 invalid recipient', exhaust: true });
  const r = await row(id);
  report.is(r.attempts, 1, 'attempts counts the one real attempt (no more 99)');
  report.ok(r.gave_up_at !== null, 'gave_up_at is set at once');
  report.is(r.next_attempt_at, null, 'nothing is scheduled');
  await makeDue(id);
  report.is((await lease()).length, 0, 'and the sweeper never leases it');
}

// ---------------------------------------------------------------------------
// Invalid payload: tokens and outcomes that do not match
// ---------------------------------------------------------------------------

report.section('invalid payload: a claim without the right live token gets nothing');
{
  await park();
  const id = await claim('token:1');
  await makeDue(id);
  const [leased] = await lease();

  report.is(await claim('token:1'), null, 'no token: the key is taken, nothing to send');
  report.is(
    await claim('token:1', { token: '00000000-0000-0000-0000-00000000dead' }),
    null,
    'a wrong token gets nothing either',
  );
  const { n } = await one(`select count(*)::int as n from email_log where dedupe_key = 'token:1'`);
  report.is(n, 1, 'and neither refusal wrote a row');

  const moved = await claim('token:1', { token: leased.lock_token, to: 'moved@brokersconnect.net' });
  report.is(moved, id, 'the lease holder gets the row back');
  report.is((await row(id)).recipient, 'moved@brokersconnect.net', 'with the recipient refreshed from the rebuild');

  // Expired: the lease lapsed, another sweeper may hold the row now.
  await db.query(`update email_log set locked_until = now() - interval '1 second' where id = $1`, [id]);
  report.is(await claim('token:1', { token: leased.lock_token }), null, 'an expired token is not honoured');
}

report.section('invalid payload: settle refuses a stranger and an unknown outcome');
{
  await park();
  const id = await claim('settle:bad');
  await makeDue(id);
  const [leased] = await lease();
  const before = await row(id);

  report.is(
    await settle(id, '00000000-0000-0000-0000-00000000beef', 'cancelled', 'x'),
    false,
    'a wrong token settles nothing and says so',
  );
  const after = await row(id);
  report.ok(after.status === before.status && after.lock_token === leased.lock_token, 'and the row is untouched, still leased');

  let raised = null;
  try {
    await settle(id, leased.lock_token, 'explode', null);
  } catch (error) {
    raised = error.message;
  }
  report.ok(raised && /unknown outcome/.test(raised), 'an unknown outcome raises rather than guessing', raised ?? 'no error');
}

report.section('settle: each outcome ends the row the way the spec says');
{
  await park();
  const make = async (key) => {
    const id = await claim(key);
    await makeDue(id);
    const leased = (await lease()).find((l) => l.id === id);
    return { id, token: leased.lock_token };
  };

  const c = await make('settle:cancelled');
  report.is(await settle(c.id, c.token, 'cancelled', 'nothing to send on retry'), true, 'cancelled: settled');
  const cr = await row(c.id);
  report.ok(cr.status === 'cancelled' && cr.next_attempt_at === null && cr.lock_token === null,
    'cancelled: status cancelled, nothing scheduled, lease cleared');
  report.is(cr.gave_up_at, null, 'cancelled: not a dead letter — nothing went wrong');

  const d = await make('settle:dead');
  report.is(await settle(d.id, d.token, 'dead', 'not retryable: applicant_digest'), true, 'dead: settled');
  const dr = await row(d.id);
  report.ok(dr.status === 'failed' && dr.gave_up_at !== null && dr.next_attempt_at === null,
    'dead: failed, given up, nothing scheduled');
  report.is(dr.attempts, 0, 'dead: attempts untouched — the provider was never asked');

  const f = await make('settle:defer');
  report.is(await settle(f.id, f.token, 'defer', 'provider not configured'), true, 'defer: settled');
  const fr = await one(
    `select status, attempts, lock_token, extract(epoch from next_attempt_at - now())::float8 / 60 as wait
       from email_log where id = $1`,
    [f.id],
  );
  report.ok(fr.status === 'queued' && fr.attempts === 0 && fr.lock_token === null,
    'defer: still queued, no attempt spent, lease cleared');
  report.ok(fr.wait > 58 && fr.wait <= 60, `defer: tried again in an hour (got ${fr.wait.toFixed(1)}m)`);

  const x = await make('settle:failed');
  report.is(await settle(x.id, x.token, 'failed', 'rebuild threw'), true, 'failed: settled');
  const xr = await row(x.id);
  report.ok(xr.status === 'failed' && xr.attempts === 1 && xr.next_attempt_at !== null && xr.gave_up_at === null,
    'failed: an attempt spent, backoff scheduled, not yet dead');

  // Four spent already: the settle that fails the fifth is the one that gives up.
  const y = await make('settle:failed-last');
  await db.query('update email_log set attempts = 4 where id = $1', [y.id]);
  await settle(y.id, y.token, 'failed', 'claim failed');
  const yr = await row(y.id);
  report.ok(yr.attempts === 5 && yr.gave_up_at !== null && yr.next_attempt_at === null,
    'failed: the fifth failed attempt dead-letters the row, same budget as a send');

  report.is(await settle(c.id, c.token, 'failed', 'late'), false, 'a second settle on a finished row matches nothing');
  report.is((await row(c.id)).status, 'cancelled', 'and cannot reopen it');
}

// ---------------------------------------------------------------------------
// Duplicate execution
// ---------------------------------------------------------------------------

report.section('duplicate execution: a leased row is not leased again');
{
  await park();
  const id = await claim('dup:1');
  await makeDue(id);
  const first = await lease();
  report.is(first.length, 1, 'the first sweep leases the row');
  const second = await lease();
  report.is(second.length, 0, 'a second sweep while the lease is live gets nothing');

  // The composer ran twice (a retried request, say): only the lease holder's
  // claim gets a row, and the key never gets a second row.
  report.is(await claim('dup:1'), null, 'the duplicate composer run claims nothing');

  await record(id, 'sent', { provider: 'prov-dup-1' });
  await record(id, 'failed', { error: 'late duplicate record' });
  const r = await row(id);
  report.is(r.status, 'sent', 'a duplicate record after the send cannot turn sent back into failed');
  report.is(r.attempts, 1, 'and does not count a second attempt');
  report.is(await settle(id, first[0].lock_token, 'failed', 'late'), false, 'nor can a late settle touch it');
}

// ---------------------------------------------------------------------------
// Worker crash
// ---------------------------------------------------------------------------

report.section('worker crash: the lease lapses and the row comes back');
{
  await park();
  const id = await claim('crash:1');
  await makeDue(id);
  const [first] = await lease(25, 30);
  report.ok(first?.id === id, 'a sweeper leases the row, then dies without recording anything');

  report.is((await lease()).length, 0, 'while its lease is live, nobody else takes the row');

  await db.query(`update email_log set locked_until = now() - interval '1 second' where id = $1`, [id]);
  const [second] = await lease();
  report.is(second?.id, id, 'once the lease lapses, the next sweep leases it again');
  report.ok(second && second.lock_token !== first.lock_token, 'under a new token');
  report.is((await row(id)).leases, 2, 'and the lease counter records the second lease');

  report.is(await settle(id, first.lock_token, 'cancelled', 'zombie'), false,
    'the dead worker, coming back, cannot settle a row it no longer holds');
  report.is(await claim('crash:1', { token: first.lock_token }), null, 'nor claim it to send');
  report.is(await claim('crash:1', { token: second.lock_token }), id, 'the live holder can');
}

report.section('worker crash: a row that kills its worker eight times is reaped');
{
  await park();
  const id = await claim('crash:poison');
  await db.query(
    `update email_log set leases = 8, next_attempt_at = now() - interval '1 minute',
            locked_until = now() - interval '1 second', lock_token = gen_random_uuid()
      where id = $1`,
    [id],
  );
  report.is((await lease()).length, 0, 'eight leases: the sweeper stops taking it');

  // A live lease is left alone, even at eight: someone is mid-send.
  const live = await claim('crash:poison-live');
  await db.query(
    `update email_log set leases = 8, locked_until = now() + interval '1 minute' where id = $1`,
    [live],
  );

  const reaped = (await one('select public.reap_email_outbox() as n')).n;
  report.ok(reaped >= 1, `the reaper dead-letters it (${reaped} reaped)`);
  const r = await row(id);
  report.ok(r.status === 'failed' && r.gave_up_at !== null && r.lock_token === null,
    'failed, given up, lease cleared');
  report.ok(/lease expired 8 times/.test(r.error ?? ''), 'and the error says why', r.error);

  const lr = await row(live);
  report.is(lr.gave_up_at, null, 'a row under a live lease is not pulled out from under its worker');
}

// ---------------------------------------------------------------------------
// Scheduler delay / missed run
// ---------------------------------------------------------------------------

report.section('scheduler delay: the three-day window is measured and reaped');
{
  await park();
  const id = await claim('window:old');
  await db.query(
    `update email_log set created_at = now() - interval '4 days', next_attempt_at = now() - interval '1 minute'
      where id = $1`,
    [id],
  );
  report.is((await lease()).length, 0, 'a row past three days is not leased — the news is stale');
  await db.query('select public.reap_email_outbox()');
  const r = await row(id);
  report.ok(r.gave_up_at !== null && /retry window elapsed/.test(r.error ?? ''),
    'the reaper dead-letters it, saying the window elapsed', r.error);
}

report.section('scheduler delay: expiry catches up on a missed run, and runs twice safely');
{
  const company = 'aaaaaaaa-0000-0000-0000-000000000001';
  const active = await q(
    `select id from jobs where company_id = $1 and status = 'active' order by id limit 3`,
    [company],
  );
  report.is(active.length, 3, 'the demo company has three live listings to work with');
  const [missed, justNow, closedFirst] = active.map((j) => j.id);

  // The nightly run did not happen for three days.
  await db.query(`update jobs set expires_at = now() - interval '3 days' where id = $1`, [missed]);
  await db.query(`update jobs set expires_at = now() - interval '1 minute' where id = $1`, [justNow]);

  // The owner closed this one before its window ran out.
  const closed = await asCommitted(USERS.employer1, `update jobs set status = 'closed' where id = '${closedFirst}' returning status`);
  report.is(closed.rows[0]?.status, 'closed', 'the owner closes a listing before it expires', closed.error);
  await db.query(`update jobs set expires_at = now() - interval '1 minute' where id = $1`, [closedFirst]);

  const first = (await one('select public.expire_stale_jobs() as n')).n;
  report.is(first, 2, 'the first run expires exactly the two listings past their window');
  const statuses = Object.fromEntries(
    (await q('select id, status from jobs where id = any($1)', [[missed, justNow, closedFirst]])).map((j) => [j.id, j.status]),
  );
  report.is(statuses[missed], 'expired', 'a listing that expired three days ago still flips — the missed run is caught up');
  report.is(statuses[justNow], 'expired', 'and so does the one that expired a minute ago');
  report.is(statuses[closedFirst], 'closed', 'a manually closed listing stays closed, not relabelled expired');

  const secondRun = (await one('select public.expire_stale_jobs() as n')).n;
  report.is(secondRun, 0, 'a second run (a retried cron, the hourly maintenance job) changes nothing');

  const reclose = await asCommitted(USERS.employer1, `update jobs set status = 'closed' where id = '${missed}' returning status`);
  report.is(reclose.rows[0]?.status, 'closed', 'an expired listing can still be closed by its owner', reclose.error);
}

report.section('scheduler delay: the applicant digest starts where the last one left off');
{
  const employer = USERS.employer2;
  // Every application to employer2's company, whichever listing: the digest
  // counts across all of them. The seed's ids are random per run.
  const apps = await q(
    `select a.id from applications a join jobs j on j.id = a.job_id
      where j.company_id = 'aaaaaaaa-0000-0000-0000-000000000002' order by a.id`,
  );
  report.is(apps.length, 3, 'the demo company has three applicants');
  const [recent, older, ancient] = apps.map((a) => a.id);

  await db.query('update profiles set notify_applicant_digest = true where id = $1', [employer]);
  await db.query(`update applications set employer_viewed_at = null where id = any($1)`, [apps.map((a) => a.id)]);
  await db.query(`update applications set created_at = now() - interval '30 hours' where id = $1`, [recent]);
  await db.query(`update applications set created_at = now() - interval '60 hours' where id = $1`, [older]);
  await db.query(`update applications set created_at = now() - interval '10 days' where id = $1`, [ancient]);

  const count = async () =>
    Number((await q(`select * from public.pending_applicant_digests('24 hours') where user_id = $1`, [employer]))[0]?.applicant_count ?? 0);

  report.is(await count(), 0, 'never had a digest: the fallback window is p_since (24h), which none fall in');

  // Yesterday's run was missed: the last digest went out 36 hours ago.
  await db.query(
    `insert into email_log (dedupe_key, template, recipient, user_id, status, sent_at, next_attempt_at)
     values ('digest:test:1', 'applicant_digest', 'employer2@brokersconnect.net', $1, 'sent', now() - interval '36 hours', null)`,
    [employer],
  );
  report.is(await count(), 1, 'last digest 36h ago: the 30h-old applicant is included, not dropped by a fixed 24h window');

  await db.query(`update email_log set sent_at = now() - interval '9 days' where dedupe_key = 'digest:test:1'`);
  report.is(await count(), 2, 'last digest 9 days ago: capped at seven days — two applicants, not the ten-day-old one');

  await db.query(
    `insert into email_log (dedupe_key, template, recipient, user_id, status, sent_at, next_attempt_at)
     values ('digest:test:2', 'applicant_digest', 'employer2@brokersconnect.net', $1, 'sent', now() - interval '20 hours', null)`,
    [employer],
  );
  report.is(await count(), 0, 'a digest 20h ago already covered them: nobody is counted twice');
}

report.section('scheduler delay: a lapsed job lease is closed as failed, not held forever');
{
  const id = (await one(`select public.begin_job_run('crash-test', 60) as id`)).id;
  report.ok(id, 'a run begins');
  await db.query(`update job_runs set lease_until = now() - interval '1 second' where id = $1`, [id]);

  const next = (await one(`select public.begin_job_run('crash-test', 60) as id`)).id;
  report.ok(next && next !== id, 'the next run, finding the lease lapsed, takes the lock');
  const dead = await one('select status, error, finished_at, lease_until from job_runs where id = $1', [id]);
  report.is(dead.status, 'failed', 'the crashed run is closed as failed');
  report.ok(/lease expired/.test(dead.error ?? ''), 'with the reason', dead.error);
  report.ok(dead.finished_at !== null && dead.lease_until === null, 'finished_at stamped, lease cleared');

  const late = (await one(`select public.finish_job_run($1, 'succeeded', '{}') as ok`, [id])).ok;
  report.is(late, false, 'the crashed run, finishing late, cannot rewrite the verdict');
  await db.query(`select public.finish_job_run($1, 'succeeded', '{}')`, [next]);
}

// ---------------------------------------------------------------------------
// Two workers
// ---------------------------------------------------------------------------

report.section('two workers: leases partition the queue');
{
  await park();
  const ids = [];
  for (let i = 0; i < 6; i += 1) {
    const id = await claim(`two:${i}`);
    await makeDue(id);
    ids.push(id);
  }
  const a = await lease(3);
  const b = await lease(3);
  const c = await lease(3);
  const seenA = new Set(a.map((r) => r.id));
  report.is(a.length + b.length, 6, 'two sweepers of three take all six due rows between them');
  report.ok(b.every((r) => !seenA.has(r.id)), 'with no row in both batches');
  report.is(c.length, 0, 'and a third finds nothing left');
  report.ok(a.every((r) => r.lock_token === a[0].lock_token), 'one token proves one batch');
  report.ok(a[0].lock_token !== b[0].lock_token, 'and the two batches hold different tokens');

  // Worker A's token is no good for worker B's row.
  report.is(await settle(b[0].id, a[0].lock_token, 'cancelled', 'x'), false, "one worker cannot settle the other's row");
}

report.section('two workers: the job lock admits one run at a time');
{
  const first = (await one(`select public.begin_job_run('lock-test', 60) as id`)).id;
  const second = (await one(`select public.begin_job_run('lock-test', 60) as id`)).id;
  report.ok(first, 'the first run takes the lease');
  report.is(second, null, 'an overlapping run of the same job gets null and stands aside');

  const skipped = await q(`select status, error, finished_at from job_runs where job = 'lock-test' and status = 'skipped'`);
  report.is(skipped.length, 1, 'the overlap is recorded as a skipped run, visible on the screen');
  report.ok(/holds the lease/.test(skipped[0]?.error ?? '') && skipped[0]?.finished_at !== null, 'saying why, and already finished');

  const other = (await one(`select public.begin_job_run('lock-test-other', 60) as id`)).id;
  report.ok(other, 'a different job is not blocked by it');

  const ok = (await one(
    `select public.finish_job_run($1, 'succeeded', '{"sent": 3, "out_of_time": false}') as ok`,
    [first],
  )).ok;
  report.is(ok, true, 'finishing the run succeeds');
  const done = await one('select * from job_runs where id = $1', [first]);
  report.is(done.status, 'succeeded', 'status succeeded');
  report.ok(done.finished_at !== null && Number.isInteger(done.duration_ms) && done.duration_ms >= 0,
    `finished_at and duration_ms recorded (${done.duration_ms}ms)`);
  report.is(done.stats?.sent, 3, 'with its stats');
  report.is(done.lease_until, null, 'and the lease released');
  report.is((await one(`select public.finish_job_run($1, 'failed', '{}', 'again') as ok`, [first])).ok, false,
    'finishing a run that is no longer running returns false');

  const third = (await one(`select public.begin_job_run('lock-test', 60) as id`)).id;
  report.ok(third && third !== first, 'with the first run finished, the next one takes the lease');
  await db.query(`select public.finish_job_run($1, 'failed', '{}', $2)`, [third, 'x'.repeat(900)]);
  const long = await one('select length(error) as n from job_runs where id = $1', [third]);
  report.is(long.n, 500, 'a long error is cut to 500 characters rather than failing the finish');
  await db.query(`select public.finish_job_run($1, 'succeeded', '{}')`, [other]);
}

// ---------------------------------------------------------------------------
// Provider outage
// ---------------------------------------------------------------------------

report.section('provider outage: a message rides it out, then stops');
{
  // The cron route's work is the TS sweep (scripts/jobs.test.mjs); here is what
  // the database does with its outcomes. An afternoon of 503s is five failed
  // attempts spread over ~14 hours, not one every ten minutes forever.
  await park();
  const ids = [];
  for (let i = 0; i < 3; i += 1) ids.push(await claim(`outage:${i}`));
  for (const id of ids) await makeDue(id);
  const leased = await lease();
  report.is(leased.length, 3, 'three messages due when the provider goes down');
  for (const l of leased) await record(l.id, 'failed', { error: '503 service unavailable' });

  const spread = await q(
    `select extract(epoch from next_attempt_at - now())::float8 / 60 as wait from email_log where id = any($1)`,
    [ids],
  );
  report.ok(spread.every((s) => s.wait > 7 && s.wait < 12.5), 'each is rescheduled 8–12 minutes out, not retried in a hot loop');
  report.is((await lease()).length, 0, 'and none is due again straight away');

  const overview = await as(USERS.admin, 'select * from public.outbox_overview()');
  report.ok(overview.ok && overview.rows.length === 1, 'the admin overview answers one row', overview.error);
  report.ok((overview.rows[0]?.waiting ?? 0) >= 3, 'counting the backed-off messages as waiting');
}

// ---------------------------------------------------------------------------
// Dead letters and requeue: admin only
// ---------------------------------------------------------------------------

report.section('dead letters are an admin screen, and requeue is an admin action');
{
  await park();
  const id = await claim('dead:requeue');
  await record(id, 'failed', { error: '422 domain not verified', exhaust: true });

  const asAdmin = await as(USERS.admin, 'select id, attempts, error from public.email_dead_letters(100)');
  report.ok(asAdmin.ok && asAdmin.rows.some((r) => r.id === id), 'an admin sees the dead letter', asAdmin.error);
  const asCandidate = await as(USERS.candidate1, 'select id from public.email_dead_letters(100)');
  report.ok(asCandidate.ok && asCandidate.rows.length === 0, 'a signed-in non-admin gets an empty list');
  const asAnon = await as(null, 'select id from public.email_dead_letters(100)', 'anon');
  report.ok(!asAnon.ok && /permission denied/.test(asAnon.error), 'anon is refused outright', asAnon.error);

  const ovCandidate = await as(USERS.candidate1, 'select * from public.outbox_overview()');
  report.ok(ovCandidate.ok && ovCandidate.rows.length === 0, 'the outbox overview is no row, not zeros, to a non-admin');

  const anon = await as(null, `select public.requeue_email('${id}')`, 'anon');
  report.ok(!anon.ok && /permission denied/.test(anon.error), 'anon cannot requeue', anon.error);
  const cand = await as(USERS.candidate1, `select public.requeue_email('${id}')`);
  report.ok(!cand.ok && /admin only/.test(cand.error), 'a candidate cannot requeue', cand.error);
  report.ok((await row(id)).gave_up_at !== null, 'and the row is still a dead letter');

  const admin = await asCommitted(USERS.admin, `select public.requeue_email('${id}') as ok`);
  report.is(admin.rows[0]?.ok, true, 'an admin requeues it');
  const r = await row(id);
  report.ok(r.gave_up_at === null && r.requeued_at !== null && r.leases === 0, 'back in the queue, window restarted, leases reset');
  report.ok(/requeued by admin/.test(r.error ?? ''), 'with the history kept in the error');
  report.ok(r.attempts <= 4, `one more try, not a fresh budget (attempts ${r.attempts})`);
  const [again] = await lease();
  report.is(again?.id, id, 'the sweeper picks it up on its next run');

  const twice = await asCommitted(USERS.admin, `select public.requeue_email('${id}') as ok`);
  report.is(twice.rows[0]?.ok, false, 'requeueing something that is not a dead letter is a no-op');

  // An old dead letter past the window comes back too — the window is from the requeue.
  const old = await claim('dead:old');
  await db.query(`update email_log set created_at = now() - interval '5 days' where id = $1`, [old]);
  await db.query('select public.reap_email_outbox()');
  await asCommitted(USERS.admin, `select public.requeue_email('${old}')`);
  await park();
  await makeDue(old);
  const back = await lease();
  report.ok(back.some((b) => b.id === old), 'a requeued message older than three days is retried, not reaped again');
  report.is(await one('select public.reap_email_outbox() as n').then((x) => x.n), 0, 'and the reaper leaves it alone');
}

// ---------------------------------------------------------------------------
// The webhook, out of order
// ---------------------------------------------------------------------------

report.section('invalid payload: webhook events cannot move a message backwards');
{
  const a = await claim('hook:a');
  await record(a, 'sent', { provider: 'prov-a' });
  await db.query(`select public.mark_email_delivered('prov-a', 'delivered')`);
  const firstDelivered = (await row(a)).delivered_at;
  const n = (await one(`select public.mark_email_delivered('prov-a', 'sent') as n`)).n;
  report.is((await row(a)).status, 'delivered', 'a late delivery_delayed (sent) does not regress delivered');
  report.is(n, 1, 'but the event is still recognised as about a real message');
  await db.query(`select public.mark_email_delivered('prov-a', 'delivered')`);
  report.is((await row(a)).delivered_at?.getTime(), firstDelivered?.getTime(), 'a replayed delivery keeps the first delivered_at');
  await db.query(`select public.mark_email_delivered('prov-a', 'complained')`);
  report.is((await row(a)).status, 'complained', 'a complaint after delivery wins');

  const b = await claim('hook:b');
  await record(b, 'sent', { provider: 'prov-b' });
  await db.query(`select public.mark_email_delivered('prov-b', 'bounced')`);
  await db.query(`select public.mark_email_delivered('prov-b', 'delivered')`);
  report.is((await row(b)).status, 'bounced', 'a delivery after a bounce is blocked');
}

report.section('invalid payload: the job log refuses what it should never hold');
{
  const bad = await as(null, `select public.begin_job_run('Not A Job; drop', 60)`, 'service_role');
  report.ok(!bad.ok && /check/.test(bad.error), 'a job name outside [a-z0-9-] is refused', bad.error);
  const status = await as(null, `select public.finish_job_run(gen_random_uuid(), 'running', '{}')`, 'service_role');
  report.ok(!status.ok, 'finish_job_run refuses a status other than succeeded/failed', status.error);
  const stats = await as(null, `insert into job_runs (job, status, stats) values ('x', 'skipped', '[1,2]')`, 'service_role');
  report.ok(!stats.ok, 'stats must be an object of counts, not an array', stats.error);
}

// ---------------------------------------------------------------------------
// Database outage: nothing runs with half a lock
// ---------------------------------------------------------------------------

report.section('database outage: a failed statement leaves no half-taken lock');
{
  // A begin that fails part-way is one transaction: either the running row
  // exists and the caller has its id, or neither. Simulated with a rollback
  // around a successful begin — the lock must go with it.
  await db.exec('begin');
  await db.query(`select public.begin_job_run('outage-test', 60)`);
  await db.exec('rollback');
  const { n } = await one(`select count(*)::int as n from job_runs where job = 'outage-test'`);
  report.is(n, 0, 'a begin rolled back by a dropped connection leaves no running row');
  const id = (await one(`select public.begin_job_run('outage-test', 60) as id`)).id;
  report.ok(id, 'so the next attempt takes the lease rather than being skipped');
  await db.query(`select public.finish_job_run($1, 'succeeded', '{}')`, [id]);

  // Same for a lease: rolled back, the rows are due again at once.
  await park();
  const mail = await claim('outage:lease');
  await makeDue(mail);
  await db.exec('begin');
  await lease();
  await db.exec('rollback');
  report.is((await lease()).map((l) => l.id).join(), mail, 'a lease lost with its transaction does not strand the row');
}

// ---------------------------------------------------------------------------
// Pruning and what admins read
// ---------------------------------------------------------------------------

report.section('job_runs: prune and the admin readers');
{
  await db.query(`update job_runs set started_at = now() - interval '100 days' where job = 'lock-test-other'`);
  const running = (await one(`select public.begin_job_run('prune-running', 60) as id`)).id;
  // Crashed a hundred days ago and never closed: still `running`, lease long lapsed.
  await db.query(
    `update job_runs set started_at = now() - interval '100 days', lease_until = now() - interval '99 days' where id = $1`,
    [running],
  );
  const pruned = (await one(`select public.prune_job_runs('90 days') as n`)).n;
  report.is(pruned, 1, 'prune removes finished runs past the keep window');
  report.is((await one('select status from job_runs where id = $1', [running]))?.status, 'running', 'and never a running one');

  const ov = await as(USERS.admin, 'select * from public.scheduled_job_overview()');
  const lockTest = ov.rows.find((r) => r.job === 'lock-test');
  report.ok(ov.ok && lockTest, 'an admin reads the scheduled job overview', ov.error);
  report.is(lockTest?.last_status, 'failed', 'last status is the last non-skipped run');
  report.ok(lockTest?.last_success_at !== null, 'last success is its own column');
  report.is(lockTest?.failures_7d, 1, 'failures in the last week are counted');
  report.is(ov.rows.find((r) => r.job === 'prune-running')?.running, false,
    'a running row with a lapsed lease does not show as running');

  const recent = await as(USERS.admin, `select * from public.recent_job_runs(50, 'lock-test')`);
  report.ok(recent.ok && recent.rows.some((r) => r.status === 'skipped'), 'recent runs include the skipped ones');

  for (const fn of ['scheduled_job_overview()', 'recent_job_runs(50)']) {
    const cand = await as(USERS.candidate1, `select * from public.${fn}`);
    report.ok(cand.ok && cand.rows.length === 0, `${fn}: a non-admin gets nothing`);
  }

  const fresh = await as(null, 'select * from public.job_freshness()', 'service_role');
  report.ok(fresh.ok && fresh.rows.find((r) => r.job === 'lock-test')?.last_success_at, 'job_freshness gives the service role a last success per job');
}

// ---------------------------------------------------------------------------
// Grants: the machinery is the service role's
// ---------------------------------------------------------------------------

report.section('service-role functions are closed to anon and signed-in users');
{
  const SERVICE_ONLY = [
    'claim_email(text, text, text, uuid, text, uuid, uuid)',
    'record_email_attempt(uuid, email_status, text, text, boolean, integer)',
    'release_email_claim(uuid)',
    'lease_due_emails(integer, integer)',
    'settle_leased_email(uuid, uuid, text, text)',
    'reap_email_outbox()',
    'pending_emails(integer)',
    'mark_email_delivered(text, email_status)',
    'begin_job_run(text, integer)',
    'finish_job_run(uuid, text, jsonb, text)',
    'prune_job_runs(interval)',
    'job_freshness()',
    'pending_applicant_digests(interval)',
    'email_retry_delay(integer)',
    'email_status_rank(email_status)',
    'expire_stale_jobs()',
  ];
  for (const fn of SERVICE_ONLY) {
    const r = await one(
      `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as auth,
              has_function_privilege('service_role', $1, 'execute') as service`,
      [`public.${fn}`],
    );
    report.ok(!r.anon && !r.auth && r.service, `${fn}: service role only`,
      `anon=${r.anon} authenticated=${r.auth} service_role=${r.service}`);
  }

  const ADMIN = [
    'requeue_email(uuid)',
    'email_dead_letters(integer)',
    'outbox_overview()',
    'scheduled_job_overview()',
    'recent_job_runs(integer, text)',
  ];
  for (const fn of ADMIN) {
    const r = await one(
      `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as auth`,
      [`public.${fn}`],
    );
    report.ok(!r.anon && r.auth, `${fn}: closed to anon, gated inside for signed-in users`);
  }

  // And in practice, not just in the catalogue.
  for (const [who, role] of [[null, 'anon'], [USERS.admin, 'authenticated']]) {
    const r = await as(who, `select * from public.lease_due_emails(100, 120)`, role);
    report.ok(!r.ok && /permission denied/.test(r.error), `${role} (even an admin) cannot lease the outbox`, r.error);
    const b = await as(who, `select public.begin_job_run('expire-jobs', 60)`, role);
    report.ok(!b.ok && /permission denied/.test(b.error), `${role} cannot take a job lease`, b.error);
  }
}

report.section('job_runs rows are invisible outside the service role');
{
  const { n } = await one('select count(*)::int as n from job_runs');
  report.ok(n > 0, `there are ${n} runs recorded`);
  const anon = await as(null, 'select count(*)::int as n from job_runs', 'anon');
  report.ok(!anon.ok || anon.rows[0].n === 0, 'anon reads none', anon.error);
  const admin = await as(USERS.admin, 'select count(*)::int as n from job_runs');
  report.ok(!admin.ok || admin.rows[0].n === 0, 'a signed-in user — an admin included — reads none directly', admin.error);
  const write = await as(USERS.admin, `insert into job_runs (job, status) values ('forged', 'running')`);
  report.ok(!write.ok, 'nor can one forge a running row to block a job', write.error);
  const { on } = await one(`select relrowsecurity as on from pg_class where relname = 'job_runs'`);
  report.ok(on, 'row-level security is on');
}

report.section('saved searches: the alert cursor is the job\'s, not the owner\'s');
{
  const owner = USERS.candidate1;
  const { id } = await one(
    `insert into saved_searches (candidate_id, label, query) values ($1, 'test cursor', 'track=primary') returning id`,
    [owner],
  );
  const cursor = await as(owner, `update saved_searches set last_checked_at = now() where id = '${id}'`);
  report.ok(!cursor.ok && /last_checked_at/.test(cursor.error), 'an owner cannot move last_checked_at to jump the queue', cursor.error);
  const reset = await as(owner, `update saved_searches set last_checked_at = null where id = '${id}'`);
  report.ok(reset.ok, 'writing the same value is not a change and is allowed', reset.error);
  const label = await as(owner, `update saved_searches set label = 'renamed' where id = '${id}' returning label`);
  report.ok(label.ok && label.rows[0]?.label === 'renamed', 'the owner can still edit the search itself', label.error);
  const job = await as(null, `update saved_searches set last_checked_at = now() where id = '${id}' returning last_checked_at`, 'service_role');
  report.ok(job.ok && job.rows[0]?.last_checked_at, 'the alert job (service role) advances it', job.error);
}

// ---------------------------------------------------------------------------
// Findings from the adversarial review, each as the incident it would be
// ---------------------------------------------------------------------------

report.section('provider not configured for a day: deferrals give their lease back');
{
  // RESEND_API_KEY missing after a deploy: every hour the sweeper leases the
  // row, finds no provider and defers it. Nothing crashed and nothing was
  // attempted, so none of that may count toward the eight-lease crash bound.
  await park();
  const id = await claim('defer:all-day');
  for (let hour = 1; hour <= 12; hour += 1) {
    await makeDue(id);
    const leased = (await lease()).find((l) => l.id === id);
    if (!leased) {
      report.ok(false, `hour ${hour}: the deferred row is still leasable`);
      break;
    }
    await settle(id, leased.lock_token, 'defer', 'provider not configured');
  }
  const r = await row(id);
  report.ok(r.leases <= 1, `twelve lease-and-defer cycles leave the lease count at ${r.leases}, not 12`);
  report.is(r.attempts, 0, 'and no attempt was spent');
  await db.query('select public.reap_email_outbox()');
  const after = await row(id);
  report.is(after.gave_up_at, null, 'the reaper does not dead-letter it as a worker crash');
  report.ok(!/lease expired/.test(after.error ?? ''), 'and nothing says a worker crashed', after.error);
  await makeDue(id);
  report.ok((await lease()).some((l) => l.id === id), 'the thirteenth hour still leases it — only the window bounds a deferral');
}

report.section('database outage: a replayed failed record counts one attempt, not two');
{
  // The record committed, its answer was lost, deliver() retried it.
  await park();
  const id = await claim('replay:failed');
  const recordExpecting = (expected) =>
    db.query('select public.record_email_attempt($1, $2, $3, $4, $5, $6)', [id, 'failed', null, '503 upstream', false, expected]);
  await recordExpecting(0);
  const first = await row(id);
  await recordExpecting(0);
  const second = await row(id);
  report.is(second.attempts, 1, 'the replay is a no-op: attempts stays 1');
  report.ok(second.next_attempt_at?.getTime() === first.next_attempt_at?.getTime(),
    'and the backoff is the first attempt\'s, not recomputed from a doubled count');
  report.is(second.gave_up_at, null, 'nor is the row given up early');

  // A retry of a leased row carries the leased count.
  await makeDue(id);
  const [leased] = await lease();
  report.is(await claim('replay:failed', { token: leased.lock_token }), id, 'the retry claims the same row');
  await recordExpecting(leased.attempts);
  await recordExpecting(leased.attempts);
  report.is((await row(id)).attempts, 2, 'the second real attempt is counted once, replayed or not');
}

report.section('dead letters keep the reason the provider gave');
{
  await park();
  const id = await claim('dead:keeps-reason', { template: 'applicant_digest' });
  await record(id, 'failed', { error: '503 upstream unavailable' });
  await makeDue(id);
  const [leased] = await lease();
  await settle(id, leased.lock_token, 'dead', 'not retryable: applicant_digest');
  const r = await row(id);
  report.ok(/503 upstream unavailable/.test(r.error ?? '') && /not retryable: applicant_digest/.test(r.error ?? ''),
    'the dead verdict is appended, and the first failure\'s text survives', r.error);
}

report.section('scheduler paused for a month: one ancient lapsed run cannot stop every job');
{
  const { id } = await one(
    `insert into job_runs (job, status, started_at, lease_until)
     values ('ancient-job', 'running', now() - interval '40 days', now() - interval '40 days' + interval '90 seconds')
     returning id`,
  );
  let started = null;
  let raised = null;
  try {
    started = (await one(`select public.begin_job_run('expire-jobs', 60) as id`)).id;
  } catch (error) {
    raised = error.message;
  }
  report.ok(started && !raised, 'begin_job_run for another job still takes its lease', raised ?? '');
  const closed = await one('select status, duration_ms from job_runs where id = $1', [id]);
  report.is(closed.status, 'failed', 'the forty-day-old run is closed as failed');
  report.ok(closed.duration_ms >= 0 && closed.duration_ms <= 2147483647,
    `with a duration that fits the column (${closed.duration_ms} ms)`);
  if (started) await db.query(`select public.finish_job_run($1, 'succeeded', '{}')`, [started]);
}

report.section('applicant digest: an applicant who arrives mid-run is in the next digest');
{
  const employer = USERS.employer2;
  const apps = await q(
    `select a.id from applications a join jobs j on j.id = a.job_id
      where j.company_id = 'aaaaaaaa-0000-0000-0000-000000000002' order by a.id`,
  );
  const [midRun] = apps.map((a) => a.id);
  await db.query('update profiles set notify_applicant_digest = true where id = $1', [employer]);
  await db.query(`update applications set employer_viewed_at = null where id = any($1)`, [apps.map((a) => a.id)]);
  await db.query(`update applications set created_at = now() - interval '40 days' where id = any($1)`, [apps.map((a) => a.id)]);
  await db.query(`delete from email_log where template = 'applicant_digest' and user_id = $1`, [employer]);

  // Yesterday's run started at T, took its list at T, and reached this
  // employer's send at T+45s. The candidate applied at T+20s — after the
  // list, before the send.
  await db.query(
    `insert into job_runs (job, status, started_at, finished_at)
     values ('daily-digest', 'succeeded', now() - interval '20 hours', now() - interval '20 hours' + interval '50 seconds')`,
  );
  await db.query(`update applications set created_at = now() - interval '20 hours' + interval '20 seconds' where id = $1`, [midRun]);
  await db.query(
    `insert into email_log (dedupe_key, template, recipient, user_id, status, sent_at, next_attempt_at)
     values ('digest:midrun', 'applicant_digest', 'employer2@brokersconnect.net', $1, 'sent',
             now() - interval '20 hours' + interval '45 seconds', null)`,
    [employer],
  );
  const rows = await q(`select * from public.pending_applicant_digests('24 hours') where user_id = $1`, [employer]);
  report.is(Number(rows[0]?.applicant_count ?? 0), 1,
    'counted today: the window starts when yesterday\'s list was taken, not when its email went');

  // A skipped overlap that started after the real run is not the anchor.
  await db.query(
    `insert into job_runs (job, status, started_at, finished_at, error)
     values ('daily-digest', 'skipped', now() - interval '20 hours' + interval '30 seconds',
             now() - interval '20 hours' + interval '30 seconds', 'another run holds the lease')`,
  );
  const again = await q(`select * from public.pending_applicant_digests('24 hours') where user_id = $1`, [employer]);
  report.is(Number(again[0]?.applicant_count ?? 0), 1, 'a skipped run in between does not move the anchor past them');
  await db.query(`delete from email_log where dedupe_key = 'digest:midrun'`);
}

report.section('a page view is not an edit: the listing version stays put');
{
  const { id, slug, version } = await one(
    `select id, slug, version from jobs where status = 'active' order by id limit 1`,
  );
  await db.query('select public.increment_job_view($1)', [slug]);
  await db.query('select public.increment_job_view($1)', [slug]);
  const viewed = await one('select version, view_count from jobs where id = $1', [id]);
  report.is(viewed.version, version,
    'two views leave the version alone — a moderation key and an open edit form both stay valid');
  await db.query('update jobs set title_ar = title_ar where id = $1', [id]);
  report.is((await one('select version from jobs where id = $1', [id])).version, version + 1,
    'a no-op write by anyone else still moves it, as migration 50 intends');
}

report.section('release_email_claim is disarmed for the old sweeper still deployed');
{
  await park();
  const id = await claim('release:old-sweeper');
  await db.query('select public.release_email_claim($1)', [id]);
  const r = await row(id);
  report.ok(r.dedupe_key === 'release:old-sweeper' && r.attempts === 0 && !/released/.test(r.error ?? ''),
    'the row keeps its key and count, so the old rebuild claims nothing and cannot send twice');
}

report.section('the backfill: rows the old code left, as migration 69 finds them');
{
  // A database as it stood before migration 69, with the rows the old sweeper
  // could leave behind, and then the migration run over them.
  const old = new PGlite({ extensions: { pgcrypto, unaccent } });
  const scripts = testDbScripts({ seed: false });
  const at = scripts.findIndex((sc) => sc.name.startsWith('20260101000069'));
  for (const sc of scripts.slice(0, at)) await old.exec(sc.sql);
  await old.exec(`
    insert into email_log (dedupe_key, template, recipient, status, attempts, error, provider_id, created_at) values
      -- released while a slow send was in flight; the send landed and bounced
      (null, 'application_status', 'x@brokersconnect.net', 'bounced', 99, ' (released for retry)', 'prov-1', now() - interval '2 days'),
      -- released and superseded by a fresh row: not a dead letter
      (null, 'application_status', 'x@brokersconnect.net', 'failed', 99, '503 (released for retry)', null, now() - interval '2 days'),
      -- claimed seconds ago; its after() send may be running right now
      ('backfill:in-flight', 'application_status', 'x@brokersconnect.net', 'queued', 0, null, null, now() - interval '10 seconds'),
      -- failed an hour ago, budget left: due now
      ('backfill:due', 'application_status', 'x@brokersconnect.net', 'failed', 1, '503', null, now() - interval '1 hour');
  `);
  for (const sc of scripts.slice(at)) await old.exec(sc.sql);

  const rows = (await old.query(
    `select dedupe_key, status, provider_id, gave_up_at, next_attempt_at,
            extract(epoch from next_attempt_at - now())::float8 as ahead
       from email_log order by created_at, provider_id nulls last`,
  )).rows;
  const bounced = rows.find((r) => r.provider_id === 'prov-1');
  report.is(bounced?.status, 'bounced', 'a released row whose send landed keeps its real outcome, not cancelled');
  const superseded = rows.find((r) => r.dedupe_key === null && r.provider_id === null);
  report.is(superseded?.status, 'cancelled', 'a released row still counted as live work is cancelled as superseded');
  const inFlight = rows.find((r) => r.dedupe_key === 'backfill:in-flight');
  report.ok(inFlight && inFlight.ahead > 240 && inFlight.ahead <= 300,
    `a row claimed seconds before the migration keeps its five-minute grace (due in ${inFlight?.ahead?.toFixed(0)}s)`);
  const due = rows.find((r) => r.dedupe_key === 'backfill:due');
  report.ok(due && due.ahead <= 1, 'an older row with budget left is due at once');
  const leased = (await old.query('select id from public.lease_due_emails(25, 90)')).rows;
  report.is(leased.length, 1, 'so the first sweep takes only the old one, not the one mid-send');
  await old.close?.();
}

await db.close?.();
process.exitCode = report.finish() ? 0 : 1;
