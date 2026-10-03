/**
 * What a retried or repeated email sends, with the database and the outbox
 * faked (scripts/email-harness) and everything else real: notify.ts, the
 * rebuilders a retry runs, and the sweeper that leases and settles rows.
 *
 *   node --experimental-strip-types --import ./scripts/email-harness/register.mjs scripts/email-retries.test.mjs
 *
 * Each section is a retry that once went wrong: a second rejection cancelled
 * for good when the history could not be read, a company refusal sent twice
 * to the member who had it and quoting the previous round's note, and the
 * visibility security notice silenced by a change earlier the same day.
 */
process.env.NEXT_PUBLIC_SITE_URL = 'https://brokers.example';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://abcdefghijklmnopqrst.supabase.co';

const { notifyAccountDecision, notifyCandidateOfStatus, notifyCompanyVerification, notifyEmployerOfModeration, notifyVisibilityChanged } =
  await import('../src/lib/email/notify.ts');
const { REBUILDERS } = await import('../src/lib/email/rebuild.ts');
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
const section = (title) => console.log(`\n— ${title}`);

const mail = (globalThis.__mail = { rows: new Map(), sends: [], retry: null, provider: () => 'sent' });
const reset = () => {
  mail.rows = new Map();
  mail.sends = [];
  mail.retry = null;
  mail.provider = () => 'sent';
};
// Quiet the senders' own warnings: the outcomes are what is checked.
console.warn = () => {};

section('a second rejection whose email failed is tried again, not cancelled, when its history cannot be read');
{
  async function retry(historyRead) {
    reset();
    globalThis.__db = {
      applications: [
        {
          id: 'A1',
          status: 'rejected',
          created_at: '2026-09-01T10:00:00Z',
          decision_note: 'We went with somebody closer to Zayed.',
          candidate_id: 'U',
          job: { id: 'J', slug: 'sales-x', title_ar: 'مستشار', title_en: 'Consultant', company: { name_ar: 'الرواد', name_en: 'Al Rowad', slug: 'al-rowad' } },
        },
      ],
      profiles: [{ id: 'U', locale: 'en', role: 'candidate', notify_status: true }],
      profile_private: [{ user_id: 'U', unsubscribe_token: 'tok' }],
      // rejected → reconsidered → rejected again: the second rejection is telling 2.
      application_events:
        historyRead === 'reads'
          ? [
              { id: 1, application_id: 'A1', to_status: 'rejected' },
              { id: 2, application_id: 'A1', to_status: 'shortlisted' },
              { id: 3, application_id: 'A1', to_status: 'rejected' },
            ]
          : () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }),
    };
    // The first rejection went out; the second one's send failed.
    mail.rows.set('status:A1:rejected', { key: 'status:A1:rejected', status: 'sent' });
    mail.rows.set('status:A1:rejected:2', { key: 'status:A1:rejected:2', status: 'failed' });
    const settled = [];
    let leased = false;
    await sweepOutbox({
      lease: async () =>
        leased ? [] : ((leased = true), [{ id: 'row-2', lock_token: 't', template: 'application_rejected', entity_id: 'A1', user_id: 'U', attempts: 1 }]),
      settle: async (id, _token, outcome) => {
        settled.push(outcome);
        return true;
      },
      rebuilders: REBUILDERS,
      runInRetryContext: async (context, fn) => {
        mail.retry = Object.assign(context, { key: 'status:A1:rejected:2' });
        try {
          return await fn();
        } finally {
          mail.retry = null;
        }
      },
      deadline: { expired: () => false },
    });
    return { sends: mail.sends.map((send) => send.key), settled };
  }

  const reads = await retry('reads');
  ok('with its history read, the retry sends the second rejection', reads.sends.join() === 'status:A1:rejected:2', JSON.stringify(reads));
  const unread = await retry('fails');
  ok(
    'with the history unreadable, it is a failure to try again — never "nothing to send", which is final',
    unread.sends.length === 0 && unread.settled.join() !== 'cancelled',
    JSON.stringify(unread),
  );
}

section("a company's refusal, retried, reaches only who missed it, with this decision's reason");
{
  function company({ members, version, decisions, papers = [], status = 'unverified' }) {
    globalThis.__db = {
      companies: [
        { id: 'C', slug: 'al-rowad', name_ar: 'الرواد', name_en: 'Al Rowad', owner_id: members[0], logo_url: null, version, verification_status: status },
      ],
      company_members: members.map((user_id) => ({ company_id: 'C', user_id })),
      profiles: members.map((id) => ({ id, locale: 'en', role: 'employer' })),
      profile_private: members.map((user_id) => ({ user_id, unsubscribe_token: `t-${user_id}` })),
      company_documents: papers,
      admin_audit_log: decisions.map((decision, index) => ({
        id: index + 1,
        target_type: 'company',
        target_id: 'C',
        created_at: `2026-10-0${index + 1}T10:00:00Z`,
        ...decision,
      })),
    };
  }

  reset();
  company({ members: ['A', 'B'], version: 5, decisions: [{ action: 'company.request_changes', reason: 'Upload a clearer commercial register.' }] });
  mail.provider = (spec) => (spec.to.startsWith('B@') ? 'failed' : 'sent');
  await notifyCompanyVerification('C', false, 'Upload a clearer commercial register.');
  const failed = [...mail.rows.values()].find((row) => row.status === 'failed');
  // A edits the company's description: its version moves on, the refusal stands.
  globalThis.__db.companies[0].version = 6;
  mail.provider = () => 'sent';
  mail.retry = { key: failed.key };
  await REBUILDERS.company_verification_needed('C', 'B');
  mail.retry = null;
  const toA = mail.sends.filter((send) => send.to.startsWith('A@') && send.outcome === 'sent').length;
  const toB = mail.sends.filter((send) => send.to.startsWith('B@') && send.outcome === 'sent').length;
  ok('the member it reached is not sent it again', toA === 1, `A received ${toA}`);
  ok('the member it missed is', toB === 1, `B received ${toB}`);

  // A sends papers again and the company is verified before B's retry comes
  // round: "changes needed" is no longer true, and is not sent.
  globalThis.__db.companies[0].verification_status = 'verified';
  const before = mail.sends.length;
  mail.retry = { key: failed.key };
  const stale = await REBUILDERS.company_verification_needed('C', 'B');
  mail.retry = null;
  ok('a refusal retried after the company was verified sends nothing', mail.sends.length === before && stale === 'skipped', stale);

  // A refusal outright after an earlier round, with no papers waiting to carry its note.
  reset();
  company({
    members: ['A'],
    version: 9,
    decisions: [
      { action: 'company.request_changes', reason: 'The tax card photo is blurry; send it again.' },
      { action: 'company.reject', reason: 'This is not a licensed brokerage.' },
    ],
    papers: [{ company_id: 'C', status: 'rejected', review_note: 'The tax card photo is blurry; send it again.', reviewed_at: '2026-10-01T10:00:00Z' }],
  });
  mail.provider = () => 'failed';
  await notifyCompanyVerification('C', false, 'This is not a licensed brokerage.');
  const key = [...mail.rows.keys()][0];
  mail.provider = () => 'sent';
  mail.retry = { key };
  await REBUILDERS.company_verification_needed('C', 'A');
  mail.retry = null;
  const retried = mail.sends.at(-1);
  ok(
    "the retry quotes this decision's reason, not the previous round's paper",
    retried?.outcome === 'sent' && retried.text.includes('This is not a licensed brokerage.') && !retried.text.includes('blurry'),
    JSON.stringify(retried?.text?.match(/[^\n]*(brokerage|blurry)[^\n]*/)?.[0] ?? retried),
  );
  ok('and is the same message the first send tried, not a new one beside it', retried?.key === key, `${retried?.key} vs ${key}`);
}

section('every change of who sees a card is told, however many in a day');
{
  reset();
  globalThis.__db = {
    profiles: [{ id: 'U', locale: 'en', role: 'candidate' }],
    profile_private: [{ user_id: 'U', unsubscribe_token: 'tok' }],
    agent_profiles: [{ user_id: 'U', visibility_chosen_at: null }],
  };
  const change = async (at, visibility) => {
    globalThis.__db.agent_profiles[0].visibility_chosen_at = at;
    return notifyVisibilityChanged('U', visibility);
  };
  const outcomes = [
    await change('2026-10-02T06:00:00Z', 'public'),
    await change('2026-10-02T10:00:00Z', 'hidden'),
    // Somebody holding the session puts the card back in front of every company.
    await change('2026-10-02T19:30:00Z', 'public'),
  ];
  ok('three changes in one day are three notices', outcomes.join() === 'sent,sent,sent', outcomes.join());
  ok('and one change published twice is one', (await notifyVisibilityChanged('U', 'public')) === 'skipped');
}

section('on a database migration 336 has not reached, a change of who sees a card is still told');
{
  reset();
  globalThis.__db = {
    profiles: [{ id: 'U', locale: 'en', role: 'candidate' }],
    profile_private: [{ user_id: 'U', unsubscribe_token: 'tok' }],
    agent_profiles: () => ({ data: null, error: { code: '42703', message: 'column agent_profiles.visibility_chosen_at does not exist' } }),
  };
  const outcome = await notifyVisibilityChanged('U', 'public');
  ok(
    'sent, keyed on the day as before 336',
    outcome === 'sent' && /^visibility:U:public:\d{4}-\d{2}-\d{2}$/.test(mail.sends[0]?.key ?? ''),
    `${outcome} ${mail.sends[0]?.key}`,
  );
}

section('an account suspended, restored and suspended again within the hour is told each time');
{
  reset();
  globalThis.__db = {
    profiles: [{ id: 'U', locale: 'en', role: 'employer' }],
    profile_private: [{ user_id: 'U', unsubscribe_token: 'tok' }],
    admin_audit_log: [{ id: 1, target_type: 'user', target_id: 'U', action: 'user.suspended' }],
  };
  const first = await notifyAccountDecision('U', false, 'A registration number linked to a banned account.');
  globalThis.__db.admin_audit_log.push(
    { id: 2, target_type: 'user', target_id: 'U', action: 'user.restored' },
    { id: 3, target_type: 'user', target_id: 'U', action: 'user.suspended' },
  );
  const second = await notifyAccountDecision('U', false, 'Listings asking candidates for a fee.');
  const again = await notifyAccountDecision('U', false, 'Listings asking candidates for a fee.');
  ok('two suspensions in one hour are two notices, each with its reason', first === 'sent' && second === 'sent', `${first} ${second}`);
  ok('and one decision published twice is one', again === 'skipped', again);
}

section("a listing's decision, retried, is sent while it stands, and only to whom it failed");
{
  reset();
  globalThis.__db = {
    jobs: [
      {
        id: 'J', slug: 'sales-x', title_ar: 'مستشار', title_en: 'Consultant', expires_at: null,
        published_at: '2026-10-01T10:00:00Z', version: 5, status: 'active', rejection_note: null,
        company: { id: 'C', owner_id: 'M1', name_ar: 'الرواد' },
      },
    ],
    company_members: [{ company_id: 'C', user_id: 'M1' }, { company_id: 'C', user_id: 'M2' }],
    profiles: ['M1', 'M2'].map((id) => ({ id, locale: 'en', role: 'employer', notify_status: true })),
    profile_private: ['M1', 'M2'].map((user_id) => ({ user_id, unsubscribe_token: `t-${user_id}` })),
  };
  mail.provider = (spec) => (spec.to.startsWith('M1@') ? 'failed' : 'sent');
  await notifyEmployerOfModeration('J', true);
  const failed = [...mail.rows.values()].find((row) => row.status === 'failed');
  mail.provider = () => 'sent';

  // The employer edits it: back in review, its version moved on.
  Object.assign(globalThis.__db.jobs[0], { status: 'pending_review', version: 7 });
  const before = mail.sends.length;
  mail.retry = { key: failed.key };
  const inReview = await REBUILDERS.job_approved('J', 'M1');
  mail.retry = null;
  ok('"your listing is live" is not sent about a listing back in review', mail.sends.length === before && inReview === 'skipped', inReview);

  // Edited where review does not look: still live, its version moved on.
  globalThis.__db.jobs[0].status = 'active';
  mail.retry = { key: failed.key };
  await REBUILDERS.job_approved('J', 'M1');
  mail.retry = null;
  const sentTo = (who) => mail.sends.filter((send) => send.to.startsWith(`${who}@`) && send.outcome === 'sent').length;
  ok('while it is live, the member whose copy failed gets it', sentTo('M1') === 1, `M1 received ${sentTo('M1')}`);
  ok('and the colleague who had it is not sent it again', sentTo('M2') === 1, `M2 received ${sentTo('M2')}`);
}

section("a refusal retried quotes the moderator's reason from where the database keeps it");
{
  // A retry passes no note: notify.ts reads it again. Since migration 347 it
  // is in job_moderation; before it, in the listing's own column.
  async function retried({ table, column = null }) {
    reset();
    globalThis.__db = {
      jobs: [
        {
          id: 'J', slug: 'sales-x', title_ar: 'مستشار', title_en: 'Consultant', expires_at: null,
          published_at: null, version: 3, status: 'rejected', rejection_note: column,
          company: { id: 'C', owner_id: 'M1', name_ar: 'الرواد' },
        },
      ],
      job_moderation: table,
      company_members: [{ company_id: 'C', user_id: 'M1' }],
      profiles: [{ id: 'M1', locale: 'en', role: 'employer', notify_status: true }],
      profile_private: [{ user_id: 'M1', unsubscribe_token: 't-M1' }],
    };
    const outcome = await notifyEmployerOfModeration('J', false);
    return { outcome, text: mail.sends.map((send) => send.text).join('\n') };
  }
  const REASON = 'The salary is not stated.';
  const after = await retried({ table: [{ job_id: 'J', rejection_note: REASON }] });
  ok('after migration 347, the reason is read beside the listing', after.outcome === 'sent' && after.text.includes(REASON), after.outcome);
  const before = await retried({
    table: () => ({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.job_moderation'" } }),
    column: REASON,
  });
  ok('before it, from the listing itself', before.outcome === 'sent' && before.text.includes(REASON), before.outcome);
  const unread = await retried({ table: () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) });
  ok('a reason that cannot be read fails the send, to be tried again, rather than sending it without', unread.outcome === 'failed', unread.outcome);
}

section('a move the bell calls no news is not emailed, whatever the outbox still holds');
{
  reset();
  globalThis.__db = {
    applications: [
      {
        id: 'A1', status: 'rejected', created_at: '2026-01-01T10:00:00Z', decision_note: null, candidate_id: 'U',
        job: { id: 'J', slug: 'sales-x', title_ar: 'مستشار', title_en: 'Consultant', company: { name_ar: 'الرواد', name_en: 'Al Rowad', slug: 'al-rowad' } },
      },
    ],
    profiles: [{ id: 'U', locale: 'en', role: 'candidate', notify_status: true }],
    profile_private: [{ user_id: 'U', unsubscribe_token: 'tok' }],
    // Rejected, reconsidered and rejected again before 345 (whose second
    // telling was swallowed), then tidied to "new" and back: the bell is
    // silent, and the second rejection's key was never claimed.
    application_events: ['rejected', 'shortlisted', 'rejected', 'new', 'rejected'].map((to_status, index) => ({
      id: index + 1,
      application_id: 'A1',
      to_status,
    })),
  };
  const outcome = await notifyCandidateOfStatus('A1');
  ok('nothing is sent', outcome === 'skipped' && mail.sends.length === 0, `${outcome} ${JSON.stringify(mail.sends.map((s) => s.key))}`);
}

section('an expiry notice is owed until every member who takes it has it');
{
  const { stillOwed } = await import('../src/lib/jobs/expiry-owed.ts');
  const { createAdminClient } = await import('./email-harness/fake-admin.mjs');
  const expires = '2026-10-05T10:00:00.000Z';
  globalThis.__db = {
    // M1 was told; M2's copy never reached the outbox (a read failed on the
    // way); M3 has these emails off.
    email_log: [{ template: 'job_expiring', entity_id: 'J1', dedupe_key: `job_expiring:J1:${expires}:M1` }],
    company_members: ['M1', 'M2', 'M3'].map((user_id) => ({ company_id: 'C', user_id })),
    profiles: [
      { id: 'M1', notify_status: true },
      { id: 'M2', notify_status: true },
      { id: 'M3', notify_status: false },
    ],
  };
  const jobs = [{ id: 'J1', company_id: 'C', expires_at: expires }];
  const owed = await stillOwed(createAdminClient(), jobs, 'expiring', { cap: 10, chunk: 50 });
  ok('a listing one member was told is still owed to the one whose copy never went', owed.length === 1, JSON.stringify(owed));
  globalThis.__db.email_log.push({ template: 'job_expiring', entity_id: 'J1', dedupe_key: `job_expiring:J1:${expires}:M2` });
  const told = await stillOwed(createAdminClient(), jobs, 'expiring', { cap: 10, chunk: 50 });
  ok('and told once everybody who takes these emails has theirs', told.length === 0, JSON.stringify(told));
  globalThis.__db.company_members = () => ({ data: null, error: { code: '57014', message: 'timeout' } });
  globalThis.__db.email_log = [{ template: 'job_expiring', entity_id: 'J1', dedupe_key: `job_expiring:J1:${expires}:M1` }];
  const unknown = await stillOwed(createAdminClient(), jobs, 'expiring', { cap: 10, chunk: 50 });
  ok('with the members unreadable, a copy sent counts as before', unknown.length === 0, JSON.stringify(unknown));
}

section('the provider: a refused key waits, and a message it already took is not sent twice');
{
  const { sendEmail } = await import('../src/lib/email/send.ts');
  const saved = { key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM, fetch: globalThis.fetch };
  process.env.RESEND_API_KEY = 're_test_0123456789';
  process.env.RESEND_FROM = 'Brokers Connect <noreply@brokersconnect.net>';
  const calls = [];
  const answer = (status, body) => async (_url, init) => {
    calls.push(init);
    return new Response(body, { status });
  };
  const message = { to: 'someone@example.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi', idempotencyKey: 'row-1' };
  try {
    globalThis.fetch = answer(403, JSON.stringify({ name: 'validation_error', message: 'The domain is not verified' }));
    const refused = await sendEmail(message);
    ok('a 403 — the key or the domain, not this message — waits instead of dead-lettering', refused.outcome === 'skipped', JSON.stringify(refused));
    globalThis.fetch = answer(401, JSON.stringify({ name: 'missing_api_key' }));
    ok('and so does a 401', (await sendEmail(message)).outcome === 'skipped');

    globalThis.fetch = answer(200, JSON.stringify({ id: 'provider-1' }));
    const sent = await sendEmail(message);
    ok(
      'the outbox row goes as the Idempotency-Key',
      sent.outcome === 'sent' && calls.at(-1)?.headers?.['Idempotency-Key'] === 'row-1',
      JSON.stringify(calls.at(-1)?.headers),
    );
    globalThis.fetch = answer(409, JSON.stringify({ name: 'invalid_idempotent_request', message: 'This idempotency key has already been used on a request that had a different payload.' }));
    ok('a key already used, with a rebuilt body, is a message that went', (await sendEmail(message)).outcome === 'sent');
    globalThis.fetch = answer(409, JSON.stringify({ name: 'concurrent_idempotent_requests' }));
    const inFlight = await sendEmail(message);
    ok('one still in flight is tried again later', inFlight.outcome === 'failed' && inFlight.retryable === true, JSON.stringify(inFlight));
    globalThis.fetch = answer(422, JSON.stringify({ name: 'validation_error', message: 'Invalid `to` field.' }));
    const bad = await sendEmail(message);
    ok('a malformed address is still final', bad.outcome === 'failed' && bad.retryable === false, JSON.stringify(bad));
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = saved.key;
    if (saved.from === undefined) delete process.env.RESEND_FROM;
    else process.env.RESEND_FROM = saved.from;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
