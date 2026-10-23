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

const { persistFailedSend } = await import('../src/lib/email/attempt-log.ts');
const { sweepOutbox } = await import('../src/lib/jobs/outbox-sweep.ts');

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

function hoursAgo(hours) {
  return new Date(Date.now() - hours * HOUR).toISOString();
}

section('a failed send writes a retryable row');
{
  const rows = [];
  const sink = {
    async insertFailed(row) {
      rows.push(row);
      return { error: null };
    },
    async updateFailed() {
      throw new Error('no existing row to update');
    },
  };
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

  is('one row', rows.length, 1);
  const row = rows[0];
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
