/**
 * A failed send is a row the retry sweeper can see, and a row too old to send
 * is not sent.
 *
 *   node --experimental-strip-types scripts/email-log.test.mjs
 *
 * The database and the provider are fakes. persistFailedSend is the write
 * deliver() uses when claim_email failed or the failure could not be recorded;
 * sweepOutbox is the retry job.
 */

const { FALLBACK_WRITE_TIMEOUT_MS, persistFailedSend } = await import('../src/lib/email/attempt-log.ts');
const { emailRowIsStale, markAgeUnknown, mergeEmailAges, sweepOutbox } = await import('../src/lib/jobs/outbox-sweep.ts');

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

const HOUR = 60 * 60 * 1000;

/**
 * The same rule as the real sink: a dedupe_key upsert ignores a duplicate
 * and leaves the existing row alone. A row with no key is always inserted.
 */
function memorySink() {
  const rows = [];
  let nextId = 1;
  return {
    rows,
    async insertFailed(row) {
      if (row.dedupe_key) {
        const existing = rows.find((stored) => stored.dedupe_key === row.dedupe_key);
        if (existing) return { error: null };
      }
      const stored = { ...row, id: `log-${nextId}`, created_at: new Date().toISOString() };
      nextId += 1;
      rows.push(stored);
      return { error: null };
    },
    async updateFailed() {
      throw new Error('no existing row to update');
    },
  };
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * HOUR).toISOString();
}

section('a failed send writes a retryable row');
{
  const sink = memorySink();
  const secret = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signaturepart';
  await persistFailedSend(
    sink,
    {
      template: 'application_receipt',
      to: 'ada@example.com',
      dedupeKey: 'application_receipt:app-1',
      userId: 'user-1',
      entity: { type: 'application', id: 'app-1' },
    },
    new Error(`Invalid API key ${secret} for ada@example.com bearer=re_live_abcdefghijk`),
  );

  is('one row', sink.rows.length, 1);
  const row = sink.rows[0];
  is('status failed, which the sweeper already retries', row.status, 'failed');
  is('the dedupe key is kept, so the retry claims this row', row.dedupe_key, 'application_receipt:app-1');
  is('the recipient is the address the row is for', row.recipient, 'ada@example.com');
  ok('gave_up_at is not set, so the row stays retryable', row.gave_up_at == null);
  ok('next_attempt_at is set, so the row is due rather than finished', Boolean(row.next_attempt_at) && !Number.isNaN(Date.parse(row.next_attempt_at)));
  ok('the stored error keeps the diagnosis', row.error.includes('Invalid API key'));
  ok('the stored error has no address', !row.error.includes('ada@') && !row.error.includes('example.com'));
  ok('the stored error has no token', !row.error.includes('eyJ') && !row.error.includes('re_live') && !row.error.includes(secret));
}

section('the retry job picks up a fresh failed row');
{
  const rebuilt = [];
  const settled = [];
  await sweepOutbox(
    {
      lease: async () => [
        {
          id: 'fresh',
          template: 'application_receipt',
          entity_id: 'app-1',
          user_id: 'user-1',
          attempts: 1,
          lock_token: 'token-fresh',
          status: 'failed',
          created_at: hoursAgo(1),
        },
        {
          id: 'requeued',
          template: 'application_receipt',
          entity_id: 'app-2',
          user_id: 'user-1',
          attempts: 4,
          lock_token: 'token-requeued',
          status: 'failed',
          created_at: hoursAgo(24 * 10),
          requeued_at: hoursAgo(1),
        },
      ],
      settle: async (id, token, outcome, detail) => {
        settled.push({ id, token, outcome, detail });
        return true;
      },
      rebuilders: {
        application_receipt: async (entityId) => {
          rebuilt.push(entityId);
          return 'sent';
        },
      },
      runInRetryContext: async (_ctx, fn) => fn(),
      deadline: { expired: () => false },
    },
    { batch: 10 },
  );

  is('a row an hour old is rebuilt', rebuilt, ['app-1', 'app-2']);
  ok('neither is closed for age', settled.every((row) => row.detail !== 'older than 48 hours'));
}

section('the retry job skips one older than 48h');
{
  const rebuilt = [];
  const settled = [];
  await sweepOutbox(
    {
      lease: async () => [
        {
          id: 'stale',
          template: 'application_receipt',
          entity_id: 'app-old',
          user_id: 'user-1',
          attempts: 1,
          lock_token: 'token-stale',
          status: 'failed',
          created_at: hoursAgo(49),
        },
        {
          id: 'blocked',
          template: 'application_receipt',
          entity_id: 'app-blocked',
          user_id: 'user-1',
          attempts: 0,
          lock_token: 'token-blocked',
          status: 'suppressed',
          created_at: hoursAgo(1),
        },
      ],
      settle: async (id, token, outcome, detail) => {
        settled.push({ id, token, outcome, detail });
        return true;
      },
      rebuilders: {
        application_receipt: async (entityId) => {
          rebuilt.push(entityId);
          return 'sent';
        },
      },
      runInRetryContext: async (_ctx, fn) => fn(),
      deadline: { expired: () => false },
    },
    { batch: 10 },
  );

  is('nothing is sent', rebuilt, []);
  is(
    'the stale row is dead-lettered, which the sweeper does not lease again',
    settled,
    [{ id: 'stale', token: 'token-stale', outcome: 'dead', detail: 'older than 48 hours' }],
  );
  ok('the suppressed row is not settled and not resent', !settled.some((row) => row.id === 'blocked'));
}

section('dedupe is the key, and a send with no key is its own row');
{
  const sink = memorySink();
  const spec = {
    template: 'application_receipt',
    to: 'ada@example.com',
    dedupeKey: 'application_receipt:app-1',
    entity: { type: 'application', id: 'app-1' },
  };
  // The claim committed this row, then its answer timed out. The fallback
  // upserts on the same key and leaves the claim alone.
  sink.rows.push({
    id: 'claimed',
    dedupe_key: spec.dedupeKey,
    template: spec.template,
    recipient: spec.to,
    entity_id: 'app-1',
    created_at: new Date().toISOString(),
    status: 'queued',
  });
  await persistFailedSend(sink, spec, new Error('claim timed out'));
  is('the keyed attempt stays one row', sink.rows.length, 1);
  is('and it is still the claim, not a second failed copy', sink.rows[0].id, 'claimed');
  is('the claim status is left alone', sink.rows[0].status, 'queued');

  const fresh = memorySink();
  await persistFailedSend(fresh, spec, new Error('claim failed before insert'));
  await persistFailedSend(fresh, spec, new Error('claim timed out'));
  is('two fallbacks for one key insert once', fresh.rows.length, 1);
  is('the inserted row keeps that key, so the unique index is the backstop', fresh.rows[0].dedupe_key, spec.dedupeKey);

  // Two applicants to one job, both emailing the employer, share entity,
  // template, and recipient. A time window would keep only the first failure.
  const unkeyed = memorySink();
  const bare = {
    template: 'application_received',
    to: 'employer@example.com',
    entity: { type: 'job', id: 'job-1' },
  };
  await persistFailedSend(unkeyed, bare, new Error('claim timed out'));
  await persistFailedSend(unkeyed, bare, new Error('claim timed out'));
  is('two failures with no key are two rows', unkeyed.rows.length, 2);
  ok(
    'even when entity, template, and recipient are the same',
    unkeyed.rows.every(
      (row) =>
        row.entity_id === 'job-1' &&
        row.template === bare.template &&
        row.recipient === bare.to &&
        row.dedupe_key == null &&
        row.status === 'failed',
    ),
  );

  const alongside = memorySink();
  alongside.rows.push({
    id: 'already-there',
    dedupe_key: null,
    template: bare.template,
    recipient: bare.to,
    entity_id: 'job-1',
    created_at: new Date().toISOString(),
    status: 'queued',
  });
  await persistFailedSend(alongside, bare, new Error('claim timed out'));
  is('a recent row with no key does not absorb the new failure', alongside.rows.length, 2);
  is('the existing row is untouched', alongside.rows[0].id, 'already-there');
  is('the new row is its own failed send', alongside.rows[1].status, 'failed');
}

section('the fallback write gives up after a few seconds');
{
  is('the limit is three seconds', FALLBACK_WRITE_TIMEOUT_MS, 3000);
  const lines = [];
  const original = console.error;
  console.error = (line) => {
    lines.push(String(line));
  };
  let threw = false;
  const started = Date.now();
  try {
    await persistFailedSend(
      {
        async insertFailed() {
          return new Promise(() => {});
        },
        async updateFailed() {
          throw new Error('not reached');
        },
      },
      { template: 'welcome_candidate', to: 'ada@example.com', dedupeKey: 'welcome:slow' },
      new Error('claim timed out'),
      undefined,
      40,
    );
  } catch {
    threw = true;
  } finally {
    console.error = original;
  }
  ok('a hung write does not throw', !threw);
  ok('it returns without waiting out the real limit', Date.now() - started < 1000);
  ok('the timeout is reported', lines.some((line) => line.includes('email log write timed out')));
  ok('the report names the domain only', lines.every((line) => !line.includes('ada@')));
}

section('a row whose age cannot be read is outside the 48h window');
{
  ok('an explicit unknown age is stale', emailRowIsStale({ ageUnknown: true, created_at: hoursAgo(1) }));
  ok('a timestamp that does not parse is stale', emailRowIsStale({ created_at: 'not-a-time' }));
  ok('a row nobody tried to date is not treated as stale', emailRowIsStale({}) === false);

  const merged = mergeEmailAges(
    [{ id: 'missing', template: 'application_receipt', entity_id: 'app-1', attempts: 0, lock_token: 't' }],
    [],
  );
  is('a row the age read did not return is marked unknown', merged[0].ageUnknown, true);
  const failedRead = markAgeUnknown([
    { id: 'unread', template: 'application_receipt', entity_id: 'app-2', attempts: 0, lock_token: 'u' },
  ]);
  is('a failed age read marks every leased row unknown', failedRead[0].ageUnknown, true);

  const rebuilt = [];
  const settled = [];
  await sweepOutbox(
    {
      lease: async () => [
        {
          id: 'unknown',
          template: 'application_receipt',
          entity_id: 'app-1',
          user_id: 'user-1',
          attempts: 0,
          lock_token: 'token-unknown',
          status: 'failed',
          ageUnknown: true,
        },
        {
          id: 'garbled',
          template: 'application_receipt',
          entity_id: 'app-2',
          user_id: 'user-1',
          attempts: 0,
          lock_token: 'token-garbled',
          status: 'failed',
          created_at: 'not-a-time',
        },
      ],
      settle: async (id, token, outcome, detail) => {
        settled.push({ id, token, outcome, detail });
        return true;
      },
      rebuilders: {
        application_receipt: async (entityId) => {
          rebuilt.push(entityId);
          return 'sent';
        },
      },
      runInRetryContext: async (_ctx, fn) => fn(),
      deadline: { expired: () => false },
    },
    { batch: 10 },
  );
  is('neither is sent', rebuilt, []);
  is(
    'both are dead-lettered for an unreadable age',
    settled,
    [
      { id: 'unknown', token: 'token-unknown', outcome: 'dead', detail: 'age could not be read' },
      { id: 'garbled', token: 'token-garbled', outcome: 'dead', detail: 'age could not be read' },
    ],
  );
}

section('a logging failure does not throw');
{
  const lines = [];
  const original = console.error;
  console.error = (line) => {
    lines.push(String(line));
  };
  const spec = {
    template: 'welcome_candidate',
    to: 'secret.user@example.com',
    dedupeKey: 'welcome:user-9',
  };
  const secret = 'sb_secret_thisisnotarealkey';
  let threw = false;
  try {
    await persistFailedSend(
      {
        async insertFailed() {
          throw new Error(`Invalid API key ${secret} while writing secret.user@example.com`);
        },
        async updateFailed() {
          throw new Error('not used');
        },
      },
      spec,
      new Error('invalid service-role key'),
    );
    await persistFailedSend(
      {
        async insertFailed() {
          return { error: { code: 'PGRST301', message: `JWT ${secret} rejected` } };
        },
        async updateFailed() {
          throw new Error('not used');
        },
      },
      spec,
      new Error('invalid service-role key'),
    );
  } catch (error) {
    threw = true;
  } finally {
    console.error = original;
  }

  ok('neither failure throws', !threw);
  is('both failures are reported', lines.length, 2);
  for (const line of lines) {
    ok('the line names the template', line.includes('welcome_candidate'));
    ok('the line names the domain only', line.includes('example.com') && line.includes('"domain"'));
    ok('the line does not name the recipient', !line.includes('secret.user'));
    ok('the line does not carry the secret', !line.includes(secret) && !line.includes('sb_secret'));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
