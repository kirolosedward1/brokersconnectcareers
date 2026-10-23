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

const { FAILED_SEND_MATCH_WINDOW_MS, FALLBACK_WRITE_TIMEOUT_MS, persistFailedSend } = await import(
  '../src/lib/email/attempt-log.ts'
);
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

/** A sink whose lookup sees the rows already inserted, the way dedupe_key does. */
function memorySink() {
  const rows = [];
  let nextId = 1;
  return {
    rows,
    async findExisting(lookup) {
      const found = rows.find((row) => {
        if (lookup.dedupeKey) return row.dedupe_key === lookup.dedupeKey;
        if (row.template !== lookup.template || row.recipient !== lookup.recipient) return false;
        if (lookup.entityId && row.entity_id !== lookup.entityId) return false;
        return Date.parse(row.created_at) >= Date.parse(lookup.createdAfter);
      });
      return { row: found ? { id: found.id } : null, error: null };
    },
    async insertFailed(row) {
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

section('a lost claim response does not insert a second row');
{
  const sink = memorySink();
  const spec = {
    template: 'application_receipt',
    to: 'ada@example.com',
    dedupeKey: 'application_receipt:app-1',
    entity: { type: 'application', id: 'app-1' },
  };
  // The claim committed this row, then its answer timed out. The fallback
  // runs as if nothing was written.
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

  const unkeyed = memorySink();
  const bare = {
    template: 'application_receipt',
    to: 'ada@example.com',
    entity: { type: 'application', id: 'app-9' },
  };
  // No dedupe key: null does not conflict with null. The claim row is found
  // by entity id, template, recipient, and the created window instead.
  unkeyed.rows.push({
    id: 'claimed-bare',
    dedupe_key: null,
    template: bare.template,
    recipient: bare.to,
    entity_id: 'app-9',
    created_at: new Date().toISOString(),
    status: 'queued',
  });
  const lookups = [];
  const findExisting = unkeyed.findExisting.bind(unkeyed);
  unkeyed.findExisting = async (lookup) => {
    lookups.push(lookup);
    return findExisting(lookup);
  };
  await persistFailedSend(unkeyed, bare, new Error('claim timed out'));
  is('the unkeyed attempt stays one row', unkeyed.rows.length, 1);
  is('looked up without a dedupe key', lookups[0]?.dedupeKey, null);
  is('by template', lookups[0]?.template, 'application_receipt');
  is('by recipient', lookups[0]?.recipient, 'ada@example.com');
  is('by the message entity id', lookups[0]?.entityId, 'app-9');
  const windowStart = Date.now() - FAILED_SEND_MATCH_WINDOW_MS - 1000;
  ok(
    'inside the created window',
    Date.parse(lookups[0]?.createdAfter) >= windowStart && Date.parse(lookups[0]?.createdAfter) <= Date.now(),
  );

  const fresh = memorySink();
  await persistFailedSend(fresh, spec, new Error('claim failed before insert'));
  await persistFailedSend(fresh, spec, new Error('claim timed out'));
  is('two fallbacks for one key insert once', fresh.rows.length, 1);
  is('the inserted row keeps that key, so the unique index is the backstop', fresh.rows[0].dedupe_key, spec.dedupeKey);
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
        async findExisting() {
          return new Promise(() => {});
        },
        async insertFailed() {
          throw new Error('not reached');
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
    const absent = async () => ({ row: null, error: null });
    await persistFailedSend(
      {
        findExisting: absent,
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
        findExisting: absent,
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
