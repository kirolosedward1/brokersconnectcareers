/**
 * The decisions background work makes, with every effect faked.
 *
 *   node --experimental-strip-types scripts/jobs.test.mjs
 *
 * src/lib/jobs/{policy,runner-core,outbox-sweep}.ts are pure on purpose — no
 * runtime imports — so that the paths only a bad day takes can be walked here
 * without a database, a provider or a clock: the provider answering 503 all
 * afternoon, the database refusing connections, the cron firing while the
 * last run is still going, a rebuild that throws. The SQL half of the same
 * scenarios is supabase/tests/jobs.test.mjs; this is what the runtime does
 * with what the SQL answers.
 *
 * Each section is one scenario, named the way the incident would be.
 */

let pass = 0;
let fail = 0;

function ok(label, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function is(label, got, want) {
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const section = (title) => console.log(`\n— ${title}`);

const {
  MAX_EMAIL_ATTEMPTS,
  classifyHttpStatus,
  isTransientDbError,
  withRetry,
  createDeadline,
  sanitizeError,
} = await import('../src/lib/jobs/policy.ts');
const { executeJobRun } = await import('../src/lib/jobs/runner-core.ts');
const { sweepOutbox } = await import('../src/lib/jobs/outbox-sweep.ts');

const noSleep = async () => {};

// ---------------------------------------------------------------------------
// policy.ts
// ---------------------------------------------------------------------------

section('policy: the attempt budget matches the database');
is('five attempts', MAX_EMAIL_ATTEMPTS, 5);

section('provider outage: which HTTP failures are worth another try');
for (const status of [408, 425, 429, 500, 502, 503, 504]) {
  is(`${status} is transient`, classifyHttpStatus(status), 'transient');
}
for (const status of [400, 401, 403, 404, 409, 422]) {
  is(`${status} is permanent — it will fail the same way every time`, classifyHttpStatus(status), 'permanent');
}

section('database outage: which database errors are a blip');
for (const [label, err] of [
  ['a fetch that failed (PostgREST unreachable)', { message: 'TypeError: fetch failed' }],
  ['a network timeout with no code', { message: 'request timed out' }],
  ['ECONNRESET', { message: 'read ECONNRESET' }],
  ['connection exception (08006)', { code: '08006', message: 'x' }],
  ['serialization failure (40001)', { code: '40001', message: 'x' }],
  ['deadlock victim (40P01)', { code: '40P01', message: 'x' }],
  ['too many connections (53300)', { code: '53300', message: 'x' }],
  ['admin shutdown (57P01)', { code: '57P01', message: 'x' }],
  ['statement timeout (57014)', { code: '57014', message: 'x' }],
  ['PostgREST could not connect (PGRST000)', { code: 'PGRST000', message: 'x' }],
  ['PostgREST schema cache not loaded (PGRST002)', { code: 'PGRST002', message: 'x' }],
]) {
  is(`${label} is transient`, isTransientDbError(err), true);
}
for (const [label, err] of [
  ['a unique violation (23505)', { code: '23505', message: 'duplicate key' }],
  ['permission denied (42501)', { code: '42501', message: 'permission denied for function' }],
  ['a raised exception (P0001), even one that mentions a network', { code: 'P0001', message: 'network of brokers is full' }],
  ['PostgREST not found (PGRST116)', { code: 'PGRST116', message: 'x' }],
  ['no error at all', null],
  ['an uncoded error about something else', { message: 'invalid input syntax' }],
]) {
  is(`${label} is not`, isTransientDbError(err), false);
}

section('database outage: withRetry retries a transient failure, and only that');
{
  const transient = Object.assign(new Error('fetch failed'), { code: '' });
  const permanent = Object.assign(new Error('duplicate key'), { code: '23505' });
  const isTransient = (e) => isTransientDbError(e);

  let calls = 0;
  const pauses = [];
  const value = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw transient;
      return 'ok';
    },
    { attempts: 3, baseMs: 100, isTransient, sleep: async (ms) => { pauses.push(ms); } },
  );
  is('recovers when the blip passes within the budget', value, 'ok');
  is('after three calls', calls, 3);
  ok('with a pause before each retry, growing', pauses.length === 2 && pauses[0] >= 50 && pauses[0] <= 150 && pauses[1] >= 100 && pauses[1] <= 300,
    JSON.stringify(pauses));

  calls = 0;
  let thrown = null;
  try {
    await withRetry(async () => { calls += 1; throw transient; }, { attempts: 4, baseMs: 1, isTransient, sleep: noSleep });
  } catch (error) {
    thrown = error;
  }
  is('an outage that outlasts the budget gives up after N attempts', calls, 4);
  ok('and rethrows the last error', thrown === transient);

  calls = 0;
  thrown = null;
  try {
    await withRetry(async () => { calls += 1; throw permanent; }, { attempts: 5, baseMs: 1, isTransient, sleep: noSleep });
  } catch (error) {
    thrown = error;
  }
  is('a permanent error is never retried', calls, 1);
  ok('and is rethrown untouched', thrown === permanent);

  calls = 0;
  await withRetry(async () => { calls += 1; return 1; }, { attempts: 3, baseMs: 1, isTransient, sleep: noSleep });
  is('success on the first try is one call', calls, 1);
}

section('policy: a deadline counts down on the injected clock');
{
  let t = 1_000;
  const deadline = createDeadline(5_000, () => t);
  is('full budget at the start', deadline.remainingMs(), 5_000);
  ok('not expired at the start', !deadline.expired());
  t += 4_999;
  is('1ms left', deadline.remainingMs(), 1);
  t += 1;
  ok('expired exactly at the budget', deadline.expired());
  t += 10_000;
  is('never negative', deadline.remainingMs(), 0);
}

section('policy: error text is stripped of addresses before it is stored');
{
  const text = sanitizeError('550 mailbox\n  unavailable for Ahmed.Ali+jobs@mail.example.co.uk,  retry later');
  ok('no address survives', !/@/.test(text), text);
  ok('it says where one was', text.includes('<address>'), text);
  ok('whitespace is collapsed', !/\s{2,}|\n/.test(text), text);
  const long = sanitizeError('x'.repeat(1000), 300);
  is('long text is cut to the limit', long.length, 300);
  ok('and marked as cut', long.endsWith('…'));
}

// ---------------------------------------------------------------------------
// runner-core.ts
// ---------------------------------------------------------------------------

function fakeRun(overrides = {}) {
  const calls = { begin: [], finish: [], work: 0, log: [] };
  let t = 0;
  const deps = {
    job: 'test-job',
    leaseSeconds: 90,
    budgetMs: 50_000,
    begin: async (job, lease) => {
      calls.begin.push([job, lease]);
      return 'run-1';
    },
    finish: async (id, status, stats, error) => {
      calls.finish.push({ id, status, stats, error });
      return true;
    },
    work: async () => {
      calls.work += 1;
      t += 1_234;
      return { sent: 2, out_of_time: false };
    },
    log: (event, detail) => calls.log.push({ event, detail }),
    now: () => t,
    ...overrides,
  };
  return { deps, calls };
}

section('duplicate execution: a second run while the first holds the lease');
{
  const { deps, calls } = fakeRun({ begin: async () => null });
  const result = await executeJobRun(deps);
  is('answers 200 — standing aside is not a failure for Vercel to alert on', result.httpStatus, 200);
  is('and says why', result.body, { job: 'test-job', skipped: 'already_running' });
  is('the work never runs', calls.work, 0);
  is('nothing is finished — there is no run to finish', calls.finish.length, 0);
  ok('the skip is logged', calls.log.some((l) => l.event === 'skipped'));
}

section('database outage: the lease cannot even be asked for');
{
  const { deps, calls } = fakeRun({
    begin: async () => {
      throw Object.assign(new Error('fetch failed for owner@brokersconnect.net'), { code: '' });
    },
  });
  const result = await executeJobRun(deps);
  is('answers 503', result.httpStatus, 503);
  is('with a fixed body', result.body, { job: 'test-job', error: 'unavailable' });
  is('the work never runs without the lock', calls.work, 0);
  const failed = calls.log.find((l) => l.event === 'failed');
  ok('the failure is logged at the begin stage', failed?.detail.stage === 'begin');
  ok('without the address in the error text', failed && !String(failed.detail.error).includes('@'), failed?.detail.error);
}

section('a run that works');
{
  const { deps, calls } = fakeRun();
  const result = await executeJobRun(deps);
  is('answers 200', result.httpStatus, 200);
  is('with the run, its stats and its duration', result.body, { job: 'test-job', run: 'run-1', sent: 2, out_of_time: false, ms: 1234 });
  is('the lease is asked for with the configured seconds', calls.begin, [['test-job', 90]]);
  is('and the run is finished as succeeded with its stats', calls.finish, [
    { id: 'run-1', status: 'succeeded', stats: { sent: 2, out_of_time: false }, error: null },
  ]);
  ok('started and completed are logged', ['started', 'completed'].every((e) => calls.log.some((l) => l.event === e)));
  is('completed carries the duration', calls.log.find((l) => l.event === 'completed')?.detail.duration_ms, 1234);
}

section('the work gets a deadline measured from the start of the run');
{
  let t = 0;
  let seen = null;
  const { deps } = fakeRun({
    budgetMs: 10_000,
    now: () => t,
    work: async ({ deadline, runId }) => {
      t += 4_000;
      seen = { runId, remaining: deadline.remainingMs(), expired: deadline.expired() };
      t += 7_000;
      seen.expiredLater = deadline.expired();
      return {};
    },
  });
  await executeJobRun(deps);
  is('the work is told its run id', seen?.runId, 'run-1');
  is('six seconds left after four', seen?.remaining, 6_000);
  ok('not expired yet', seen && !seen.expired);
  ok('expired once the budget is spent', seen?.expiredLater === true);
}

section('provider outage: the work throws');
{
  const { deps, calls } = fakeRun({
    work: async () => {
      throw new Error('Resend 503 while sending to candidate7@demo.test: upstream   unavailable');
    },
  });
  const result = await executeJobRun(deps);
  is('answers 500', result.httpStatus, 500);
  is('with a fixed body — never the raw message', result.body, { job: 'test-job', run: 'run-1', error: 'failed' });
  ok('the response has no trace of the error text', !JSON.stringify(result.body).includes('Resend'));
  is('the run is finished as failed', calls.finish[0]?.status, 'failed');
  const stored = calls.finish[0]?.error ?? '';
  ok('with the reason', stored.includes('Resend 503'), stored);
  ok('sanitized: no address', !stored.includes('@'), stored);
  ok('sanitized: whitespace collapsed', !/\s{2,}/.test(stored), stored);
  const failed = calls.log.find((l) => l.event === 'failed');
  ok('the failure is logged, sanitized too', failed && !String(failed.detail.error).includes('@'));
}

section('database outage: finishing the run fails');
{
  const { deps, calls } = fakeRun({
    finish: async () => {
      throw new Error('connection terminated');
    },
  });
  const result = await executeJobRun(deps);
  is('the work outcome still stands: 200', result.httpStatus, 200);
  is('with its stats', result.body.sent, 2);
  ok('the finish failure is logged', calls.log.some((l) => l.event === 'failed' && l.detail.stage === 'finish'));

  const failing = fakeRun({
    work: async () => { throw new Error('boom'); },
    finish: async () => { throw new Error('connection terminated'); },
  });
  const r2 = await executeJobRun(failing.deps);
  is('and a failed run is still reported failed, not masked', r2.httpStatus, 500);

  const lapsed = fakeRun({ finish: async () => false });
  const r3 = await executeJobRun(lapsed.deps);
  is('a run whose lease was already closed still answers its outcome', r3.httpStatus, 200);
  ok('and the lapse is logged', lapsed.calls.log.some((l) => l.event === 'failed' && l.detail.stage === 'finish'));
}

// ---------------------------------------------------------------------------
// outbox-sweep.ts
// ---------------------------------------------------------------------------

/**
 * A fake outbox. `rows` are served by lease() in batches; each row's `does`
 * says what its rebuild does to the retry context (standing in for deliver()).
 */
function fakeOutbox(rows, { deadline, rebuilders } = {}) {
  const queue = [...rows];
  const settled = [];
  const leases = [];
  const contexts = [];
  const deps = {
    lease: async (limit) => {
      const batch = queue.splice(0, limit);
      leases.push(batch.length);
      return batch.map(({ id, template, entity_id, attempts = 0 }) => ({
        id,
        template,
        entity_id,
        attempts,
        lock_token: `token-${id}`,
      }));
    },
    settle: async (id, token, outcome, detail) => {
      settled.push({ id, token, outcome, detail });
      return true;
    },
    rebuilders: rebuilders ?? {},
    runInRetryContext: async (ctx, fn) => {
      contexts.push(ctx);
      return fn(ctx);
    },
    deadline: deadline ?? { remainingMs: () => 60_000, expired: () => false },
  };
  return { deps, settled, leases, contexts };
}

/**
 * A rebuilder whose behaviour is chosen per entity — what deliver() would do
 * to the context for that message, and what the rebuild returns.
 */
function scripted(behaviours, ctxRef) {
  return async (entityId) => {
    const ctx = ctxRef.current();
    const b = behaviours[entityId];
    return b(ctx);
  };
}

section('outbox sweep: every outcome settles the right way');
{
  const rows = [
    { id: 'r-sent', template: 'application_status', entity_id: 'e-sent' },
    { id: 'r-provider-down', template: 'application_status', entity_id: 'e-provider-down' },
    { id: 'r-no-rebuilder', template: 'applicant_digest', entity_id: 'e-x' },
    { id: 'r-no-entity', template: 'application_status', entity_id: null },
    { id: 'r-throws', template: 'application_status', entity_id: 'e-throws' },
    { id: 'r-unconfigured', template: 'application_status', entity_id: 'e-unconfigured' },
    { id: 'r-opted-out', template: 'application_status', entity_id: 'e-opted-out' },
    { id: 'r-superseded', template: 'application_status', entity_id: 'e-superseded' },
    { id: 'r-claim-error', template: 'application_status', entity_id: 'e-claim-error' },
  ];
  let current = null;
  const behaviours = {
    // deliver() claimed the leased row and recorded a send.
    'e-sent': (ctx) => { ctx.touched = true; return 'sent'; },
    // Provider outage: deliver() claimed the row and recorded a failed attempt itself.
    'e-provider-down': (ctx) => { ctx.touched = true; return 'failed'; },
    'e-throws': () => { throw new Error('rebuild exploded'); },
    'e-unconfigured': (ctx) => { ctx.deferred = true; return 'failed'; },
    // The recipient turned notifications off: nothing claimed, nothing sent.
    'e-opted-out': () => 'skipped',
    'e-superseded': (ctx) => { ctx.claimedOther = true; return 'sent'; },
    'e-claim-error': (ctx) => { ctx.claimError = true; return 'failed'; },
  };
  const outbox = fakeOutbox(rows, {
    rebuilders: { application_status: scripted(behaviours, { current: () => current }) },
  });
  const run = outbox.deps.runInRetryContext;
  outbox.deps.runInRetryContext = (ctx, fn) => { current = ctx; return run(ctx, fn); };

  const stats = await sweepOutbox(outbox.deps, { batch: 20 });
  const by = Object.fromEntries(outbox.settled.map((s) => [s.id, s]));

  is('stats add up', stats, { leased: 9, sent: 1, failed: 3, cancelled: 1, dead: 2, deferred: 1, superseded: 1 });
  is('sent: deliver() recorded it, so the sweep settles nothing', by['r-sent'], undefined);
  is('provider outage: deliver() recorded the failed attempt (with backoff), the sweep adds nothing', by['r-provider-down'], undefined);
  is('no rebuilder: dead, saying which template', [by['r-no-rebuilder']?.outcome, by['r-no-rebuilder']?.detail], ['dead', 'not retryable: applicant_digest']);
  is('no entity: dead', [by['r-no-entity']?.outcome, by['r-no-entity']?.detail], ['dead', 'not retryable: no entity']);
  is('rebuild throws: a failed attempt, so it cannot loop forever', [by['r-throws']?.outcome, by['r-throws']?.detail], ['failed', 'rebuild threw']);
  ok('and the thrown message is not written anywhere', !JSON.stringify(outbox.settled).includes('exploded'));
  is('provider not configured: deferred, no attempt spent', [by['r-unconfigured']?.outcome, by['r-unconfigured']?.detail], ['defer', 'provider not configured']);
  is('opted out: cancelled, nothing to send', [by['r-opted-out']?.outcome, by['r-opted-out']?.detail], ['cancelled', 'nothing to send on retry']);
  is('superseded by a new row: cancelled as superseded', [by['r-superseded']?.outcome, by['r-superseded']?.detail], ['cancelled', 'superseded by a new row']);
  is('claim failed: a failed attempt', [by['r-claim-error']?.outcome, by['r-claim-error']?.detail], ['failed', 'claim failed']);

  ok('each row settled with its own lease token', outbox.settled.every((s) => s.token === `token-${s.id}`));
  const counts = {};
  for (const s of outbox.settled) counts[s.id] = (counts[s.id] ?? 0) + 1;
  ok('no row settled more than once', Object.values(counts).every((n) => n === 1), JSON.stringify(counts));
  is('rows the rebuild ran for got a fresh context each', outbox.contexts.length, 7);
  ok('each context carries its row id and token, starting clean', outbox.contexts.every((c) =>
    c.leaseToken === `token-${c.leasedId}`), JSON.stringify(outbox.contexts.map((c) => c.leasedId)));
}

section('outbox sweep: a fresh context per row, never shared');
{
  const rows = [
    { id: 'a', template: 't', entity_id: '1' },
    { id: 'b', template: 't', entity_id: '2' },
  ];
  const seen = [];
  const outbox = fakeOutbox(rows, {
    rebuilders: {
      t: async () => 'skipped',
    },
  });
  const run = outbox.deps.runInRetryContext;
  outbox.deps.runInRetryContext = (ctx, fn) => {
    seen.push({ ...ctx });
    ctx.touched = true; // as if the first row's deliver() touched it
    return run(ctx, fn);
  };
  await sweepOutbox(outbox.deps, { batch: 10 });
  ok('the second row does not inherit the first row\'s touched flag', seen[1] && seen[1].touched === false);
}

section('scheduler delay: the sweep stops leasing when its time is up');
{
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, template: 't', entity_id: `e${i}` }));
  let batches = 0;
  const deadline = { remainingMs: () => (batches >= 2 ? 0 : 1000), expired: () => batches >= 2 };
  const outbox = fakeOutbox(rows, {
    deadline,
    rebuilders: { t: async () => 'skipped' },
  });
  const lease = outbox.deps.lease;
  outbox.deps.lease = async (limit) => { batches += 1; return lease(limit); };

  const stats = await sweepOutbox(outbox.deps, { batch: 10 });
  is('two batches leased, then the deadline stops it', outbox.leases, [10, 10]);
  is('twenty rows handled', stats.leased, 20);
  is('every leased row is settled, even the batch that ran past the deadline', outbox.settled.length, 20);

  const expired = fakeOutbox(rows, { deadline: { remainingMs: () => 0, expired: () => true } });
  const s2 = await sweepOutbox(expired.deps, { batch: 10 });
  is('an already-expired deadline leases nothing at all', [s2.leased, expired.leases.length], [0, 0]);
}

section('outbox sweep: an empty or short batch ends the sweep');
{
  const empty = fakeOutbox([]);
  const s = await sweepOutbox(empty.deps, { batch: 10 });
  is('an empty queue: one lease call, nothing else', [empty.leases, s.leased], [[0], 0]);

  const short = fakeOutbox([{ id: 'x', template: 'nope', entity_id: 'e' }]);
  await sweepOutbox(short.deps, { batch: 10 });
  is('a short batch means drained: no second lease', short.leases, [1]);
}

section('two workers: a settle that loses the lease is not retried or double-counted');
{
  // settle() answering false is the database saying another worker holds the
  // row now. The sweep moves on; it must not settle the row a second time.
  const outbox = fakeOutbox([{ id: 'z', template: 'none', entity_id: 'e' }]);
  let calls = 0;
  outbox.deps.settle = async () => { calls += 1; return false; };
  const stats = await sweepOutbox(outbox.deps, { batch: 10 });
  is('one settle call, no retry of it', calls, 1);
  is('counted once', stats.dead, 1);
}

section('outbox sweep: a rebuild that fails before any claim is retried, not cancelled');
{
  // A PostgREST 503 on the composer's own read: it catches, returns 'failed',
  // and never reaches claim_email. That is an outage, not "nothing to send".
  const outbox = fakeOutbox([{ id: 'r-read-failed', template: 't', entity_id: 'e', attempts: 2 }], {
    rebuilders: { t: async () => 'failed' },
  });
  const stats = await sweepOutbox(outbox.deps, { batch: 10 });
  is('settled as a failed attempt, which backs off and ends in the dead letters',
    [outbox.settled[0]?.outcome, outbox.settled[0]?.detail], ['failed', 'rebuild failed']);
  is('counted as failed', [stats.failed, stats.cancelled], [1, 0]);
  is('the context carries the leased attempt count for deliver() to pass on', outbox.contexts[0]?.attempts, 2);
}

section('outbox sweep: a colleague\'s new row does not cancel a member whose claim failed');
{
  // new_application goes to every member. A member who joined since gets a
  // fresh row (claimedOther) while the leased member's own claim errors.
  let current = null;
  const outbox = fakeOutbox([{ id: 'r-member-x', template: 't', entity_id: 'app' }], {
    rebuilders: {
      t: async () => {
        current.claimedOther = true;
        current.claimError = true;
        return 'failed';
      },
    },
  });
  const run = outbox.deps.runInRetryContext;
  outbox.deps.runInRetryContext = (ctx, fn) => { current = ctx; return run(ctx, fn); };
  const stats = await sweepOutbox(outbox.deps, { batch: 10 });
  is('a failed attempt on the leased row, not "superseded"',
    [outbox.settled[0]?.outcome, outbox.settled[0]?.detail], ['failed', 'claim failed']);
  is('nothing counted as superseded', stats.superseded, 0);

  // And a read that failed for the leased member while a colleague's fresh
  // row went: the rebuild reports 'failed', which outranks the new row.
  const second = fakeOutbox([{ id: 'r-member-y', template: 't', entity_id: 'app' }], {
    rebuilders: { t: async () => { current.claimedOther = true; return 'failed'; } },
  });
  const run2 = second.deps.runInRetryContext;
  second.deps.runInRetryContext = (ctx, fn) => { current = ctx; return run2(ctx, fn); };
  await sweepOutbox(second.deps, { batch: 10 });
  is('also a failed attempt, retried later', second.settled[0]?.outcome, 'failed');
}

section('database outage: one settle that throws does not strand the rest of the batch');
{
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, template: 'none', entity_id: 'e' }));
  const outbox = fakeOutbox(rows);
  const settledIds = [];
  outbox.deps.settle = async (id) => {
    if (id === 's1') throw new Error('database gone');
    settledIds.push(id);
    return true;
  };
  let raised = null;
  try {
    await sweepOutbox(outbox.deps, { batch: 10 });
  } catch (error) {
    raised = error.message;
  }
  is('every other leased row is still settled', settledIds, ['s0', 's2', 's3', 's4']);
  is('and the failure is raised after the batch, so the run is recorded as failed', raised, 'database gone');
  is('nothing more is leased after it', outbox.leases.length, 1);
}

// ---------------------------------------------------------------------------
// The cron routes
// ---------------------------------------------------------------------------

section('every cron route checks the secret the same way');
{
  /*
    runScheduledJob compares the bearer in constant time and refuses a missing
    secret or an unedited REPLACE_ME (cronAuthorised for a route that does not
    run through it). The lifecycle route compared the header with `!==`
    against the raw variable, so the placeholder from the import file opened
    it. Read off the routes themselves, so a new one cannot quietly differ.
  */
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../src/app/api/cron/', import.meta.url);
  for (const name of readdirSync(dir)) {
    const source = readFileSync(new URL(`${name}/route.ts`, dir), 'utf8');
    ok(
      `/api/cron/${name} authorises through runScheduledJob or cronAuthorised`,
      /runScheduledJob\(|cronAuthorised\(/.test(source) && !/headers\.get\(['"]authorization['"]\)\s*[!=]==/.test(source),
    );
  }

  // The health check answers the operator to the same bearer, and so to the
  // same rule: the placeholder is no secret.
  const health = readFileSync(new URL('../src/app/api/health/route.ts', import.meta.url), 'utf8');
  ok(
    '/api/health refuses the placeholder too (configuredValue or cronAuthorised)',
    /secretsMatch\([^;]*configuredValue\(env\.cronSecret\)\)|cronAuthorised\(/.test(health) && !/secretsMatch\([^;]*,\s*env\.cronSecret\)/.test(health),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
