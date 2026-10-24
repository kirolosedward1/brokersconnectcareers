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

const {
  notifyAccountDecision,
  notifyCandidateOfStatus,
  notifyCompanyVerification,
  notifyCompanyVerificationRevoked,
  notifyBrokerOfJobApproval,
  notifyBrokerOfWithdrawal,
  notifyEmployerOfApplication,
  notifyEmployerOfModeration,
  notifyVisibilityChanged,
  rebuildJobExpiry,
} = await import('../src/lib/email/notify.ts');
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
    company_members: [
      { company_id: 'C', user_id: 'M1' },
      { company_id: 'C', user_id: 'M2' },
      { company_id: 'C', user_id: 'M3' },
    ],
    profiles: ['M1', 'M2', 'M3'].map((id) => ({ id, locale: 'en', role: 'employer', notify_status: true })),
    profile_private: ['M1', 'M2', 'M3'].map((user_id) => ({ user_id, unsubscribe_token: `t-${user_id}` })),
  };
  // M1 owns the company and is told by the transactional receipt, not this copy.
  mail.provider = (spec) => (spec.to.startsWith('M2@') ? 'failed' : 'sent');
  await notifyEmployerOfModeration('J', true);
  const failed = [...mail.rows.values()].find((row) => row.status === 'failed');
  ok('the owner is not sent the preference copy', [...mail.rows.values()].every((row) => !String(row.to).startsWith('M1@')));
  mail.provider = () => 'sent';

  // The employer edits it: back in review, its version moved on.
  Object.assign(globalThis.__db.jobs[0], { status: 'pending_review', version: 7 });
  const before = mail.sends.length;
  mail.retry = { key: failed.key };
  const inReview = await REBUILDERS.job_approved('J', 'M2');
  mail.retry = null;
  ok('"your listing is live" is not sent about a listing back in review', mail.sends.length === before && inReview === 'skipped', inReview);

  // Edited where review does not look: still live, its version moved on.
  globalThis.__db.jobs[0].status = 'active';
  mail.retry = { key: failed.key };
  await REBUILDERS.job_approved('J', 'M2');
  mail.retry = null;
  const sentTo = (who) => mail.sends.filter((send) => send.to.startsWith(`${who}@`) && send.outcome === 'sent').length;
  ok('while it is live, the member whose copy failed gets it', sentTo('M2') === 1, `M2 received ${sentTo('M2')}`);
  ok('and the colleague who had it is not sent it again', sentTo('M3') === 1, `M3 received ${sentTo('M3')}`);
  ok('and the owner is still not sent the preference copy', sentTo('M1') === 0);
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

section('a verification taken away is told once per revocation, while it stands, and without its reason');
{
  reset();
  globalThis.__db = {
    companies: [
      { id: 'C', slug: 'al-rowad', name_ar: 'الرواد', name_en: 'Al Rowad', logo_url: null, version: 4, verification_status: 'unverified' },
    ],
    admin_audit_log: [
      { id: 41, target_type: 'company', target_id: 'C', action: 'company.revoke', reason: 'Register expired (internal)', created_at: '2026-10-03T10:00:00Z' },
    ],
    company_members: [{ company_id: 'C', user_id: 'M1' }, { company_id: 'C', user_id: 'M2' }],
    profiles: ['M1', 'M2'].map((id) => ({ id, locale: 'en', role: 'employer', notify_status: true })),
    profile_private: ['M1', 'M2'].map((user_id) => ({ user_id, unsubscribe_token: `t-${user_id}` })),
  };
  const sentTo = (who) => mail.sends.filter((send) => send.to.startsWith(`${who}@`) && send.outcome === 'sent').length;

  const first = await notifyCompanyVerificationRevoked('C');
  ok('every member is told', first === 'sent' && sentTo('M1') === 1 && sentTo('M2') === 1, `${first} M1:${sentTo('M1')} M2:${sentTo('M2')}`);
  ok("without the reason the console keeps", !mail.sends.some((send) => send.text.includes('internal')));
  const again = await notifyCompanyVerificationRevoked('C');
  ok('one revocation published twice is one message each', again === 'skipped' && sentTo('M1') === 1, again);

  // Verified again since: a retry of the old revocation is not news.
  globalThis.__db.companies[0].verification_status = 'verified';
  const stale = await REBUILDERS.company_verification_revoked('C', 'M1');
  ok('a retry after the company was verified again is not sent', stale === 'skipped' && sentTo('M1') === 1, stale);

  // Revoked again: a new decision, told again.
  globalThis.__db.companies[0].verification_status = 'unverified';
  globalThis.__db.admin_audit_log.push(
    { id: 57, target_type: 'company', target_id: 'C', action: 'company.revoke', reason: 'Second look', created_at: '2026-10-05T10:00:00Z' },
  );
  const second = await notifyCompanyVerificationRevoked('C');
  ok('revoked a second time, it is told again', second === 'sent' && sentTo('M1') === 2 && sentTo('M2') === 2, `${second} M1:${sentTo('M1')}`);
}

section('a suspended company is not emailed its applicants (349)');
{
  reset();
  globalThis.__db = {
    applications: [
      {
        id: 'A2', created_at: '2026-10-03T09:00:00Z', experience_band: 'junior_1_3', candidate_id: 'U2',
        job: {
          id: 'J', slug: 'sales-x', title_ar: 'مستشار', title_en: 'Consultant', expires_at: null, published_at: null, version: 1,
          company: { id: 'C', suspended_at: '2026-10-03T10:00:00Z' },
        },
      },
    ],
    company_members: [{ company_id: 'C', user_id: 'M1' }],
    profiles: [
      { id: 'M1', locale: 'en', role: 'employer', notify_applications: true, notify_applicant_digest: false },
      { id: 'U2', full_name: 'Mona Saleh', role: 'candidate' },
    ],
    profile_private: [{ user_id: 'M1', unsubscribe_token: 't-M1' }],
  };
  const suspended = await notifyEmployerOfApplication('A2');
  ok('while it is suspended, nothing is sent, not even the name', suspended === 'skipped' && mail.sends.length === 0, suspended);
  globalThis.__db.applications[0].job.company.suspended_at = null;
  const lifted = await notifyEmployerOfApplication('A2');
  ok(
    "once it is not, the member is told, with the applicant's name",
    lifted === 'sent' && mail.sends.some((send) => send.text.includes('Mona Saleh')),
    `${lifted} ${mail.sends.length}`,
  );
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

section('an expiry email counts standing applicants and leaves a withdrawal out');
{
  reset();
  globalThis.__db = {
    jobs: [
      {
        id: 'J1',
        status: 'active',
        expires_at: '2020-01-01T00:00:00.000Z',
        title_ar: 'مستشار',
        title_en: 'Consultant',
        slug: 'sales-x',
        version: 1,
        company: { id: 'C', owner_id: 'M1', name_ar: 'الرواد' },
      },
    ],
    applications: [
      { id: 'A1', job_id: 'J1', status: 'new' },
      { id: 'A2', job_id: 'J1', status: 'shortlisted' },
      { id: 'A3', job_id: 'J1', status: 'withdrawn' },
    ],
    company_members: [{ company_id: 'C', user_id: 'M1' }],
    profiles: [{ id: 'M1', locale: 'en', role: 'employer', notify_status: true }],
    profile_private: [{ user_id: 'M1', unsubscribe_token: 'tok' }],
  };
  const outcome = await rebuildJobExpiry('J1', 'expired');
  const text = mail.sends.map((send) => send.text).join('\n');
  ok('sent, and the count is the two who are still applicants', outcome === 'sent' && text.includes('Total applicants: 2'), `${outcome} ${text}`);
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

section('the owner is told once when a listing is approved, and once when a candidate withdraws');
{
  const { readFileSync } = await import('node:fs');
  const { copyFor } = await import('../src/lib/email/copy.ts');
  const { renderPreview } = await import('../src/lib/email/preview.ts');
  const events = readFileSync(new URL('../src/lib/notifications/events.ts', import.meta.url), 'utf8');
  const routes = (name) => events.slice(events.indexOf(`${name}:`));
  ok(
    'approving a listing emails the owner from the approval route',
    /notifyBrokerOfJobApproval\(e\.jobId\)/.test(routes('JOB_APPROVED').slice(0, 500)),
  );
  ok(
    'a withdrawal emails the owner from the withdrawal route',
    /notifyBrokerOfWithdrawal\(e\.applicationId\)/.test(routes('APPLICATION_WITHDRAWN').slice(0, 800)),
  );

  const savedSupport = process.env.SUPPORT_EMAIL;
  const savedOwner = process.env.OWNER_NOTIFY_EMAIL;
  process.env.SUPPORT_EMAIL = 'info@topsuite.net';
  delete process.env.OWNER_NOTIFY_EMAIL;
  try {
    for (const locale of ['ar', 'en']) {
      const approved = renderPreview('job_approved_owner', locale, 'default');
      const withdrew = renderPreview('candidate_withdrew', locale, 'default');
      const bare = renderPreview('candidate_withdrew', locale, 'minimal');
      const tApproved = copyFor(locale).jobApprovedOwner;
      const job = locale === 'ar' ? 'مستشار عقاري أول' : 'Senior Property Consultant';
      const name = locale === 'ar' ? 'أحمد محمود' : 'Ahmed Mahmoud';
      const exactApproved =
        locale === 'ar'
          ? {
              subject: 'تمت الموافقة على «مستشار عقاري أول»',
              heading: 'تمت الموافقة على إعلانك',
              body: '«مستشار عقاري أول» ظاهر للمرشحين الآن. ستصلك رسالة عند كل تقديم جديد.',
            }
          : {
              subject: '"Senior Property Consultant" is approved',
              heading: 'Your listing is approved',
              body: '"Senior Property Consultant" is visible to candidates now. You will receive an email for each new application.',
            };
      const exactWithdrew =
        locale === 'ar'
          ? {
              subject: 'انسحب مرشح من «مستشار عقاري أول»',
              heading: 'انسحب مرشح',
              body: 'انسحب أحمد محمود من «مستشار عقاري أول». لم يعد هذا التقديم قائماً.',
              unnamed: 'انسحب مرشح من «مستشار عقاري أول». لم يعد هذا التقديم قائماً.',
            }
          : {
              subject: 'A candidate withdrew from "Senior Property Consultant"',
              heading: 'A candidate withdrew',
              body: 'Ahmed Mahmoud withdrew from "Senior Property Consultant". This application is no longer active.',
              unnamed: 'A candidate withdrew from "Senior Property Consultant". This application is no longer active.',
            };
      ok(`${locale} approval subject`, approved.subject === exactApproved.subject, approved.subject);
      ok(`${locale} approval heading`, approved.text.startsWith(exactApproved.heading) && approved.html.includes(exactApproved.heading));
      ok(`${locale} approval body`, approved.text.includes(exactApproved.body));
      ok(`${locale} approval button`, approved.html.includes(locale === 'ar' ? 'عرض الإعلان' : 'View the listing'));
      ok(`${locale} approval is one language`, locale === 'ar' ? !approved.html.includes('Your listing is approved') : !approved.html.includes('تمت الموافقة على إعلانك'));
      ok(`${locale} approval is Arabic-first RTL when Arabic`, locale !== 'ar' || (approved.html.includes('lang="ar"') && approved.html.includes('dir="rtl"')));
      ok(`${locale} approval is left to right in English`, locale !== 'en' || approved.html.includes('dir="ltr"'));
      ok(`${locale} approval has no unsubscribe`, !approved.html.includes('/unsubscribe') && approved.unsubscribeUrl == null);
      ok(`${locale} approval names support`, approved.html.includes('mailto:info@topsuite.net'));
      ok(`${locale} approval matches its own copy`, approved.subject === tApproved.subject(job) && approved.text.includes(tApproved.body(job)));
      ok(`${locale} withdrawal subject`, withdrew.subject === exactWithdrew.subject, withdrew.subject);
      ok(`${locale} withdrawal heading`, withdrew.text.startsWith(exactWithdrew.heading) && withdrew.html.includes(exactWithdrew.heading));
      ok(`${locale} withdrawal body`, withdrew.text.includes(exactWithdrew.body));
      ok(`${locale} withdrawal button`, withdrew.html.includes(locale === 'ar' ? 'عرض المتقدمين' : 'View applicants'));
      ok(`${locale} withdrawal without a name`, bare.subject === exactWithdrew.subject && bare.text.includes(exactWithdrew.unnamed) && !bare.text.includes(name));
      ok(`${locale} withdrawal is one language`, locale === 'ar' ? !withdrew.html.includes('A candidate withdrew') : !withdrew.html.includes('انسحب مرشح'));
      ok(`${locale} withdrawal has no unsubscribe`, bare.unsubscribeUrl == null && !bare.html.includes('/unsubscribe'));
      ok(
        `${locale} withdrawal copy is not Egyptian`,
        locale !== 'ar' || !/مفيش|عايز|دلوقتي|بتاع|اتنشر|هيخلص/.test(withdrew.text),
      );
    }

    const hostile = renderPreview('candidate_withdrew', 'ar', 'long');
    // The long fixture's name is ordinary. The escape check uses a composed send below.
    ok('a long Arabic withdrawal still renders', hostile.html.includes('dir="rtl"') && hostile.text.length > 20);

    function listing(overrides = {}) {
      return {
        id: 'J',
        slug: 'sales-x',
        title_ar: 'مستشار <أول>',
        title_en: 'Consultant',
        expires_at: '2026-12-01T00:00:00Z',
        published_at: '2026-10-01T10:00:00Z',
        version: 5,
        status: 'active',
        rejection_note: null,
        company: { id: 'C', owner_id: 'OWNER', name_ar: 'الرواد', suspended_at: null },
        ...overrides,
      };
    }
    function people(locale = 'ar') {
      return {
        profiles: [
          { id: 'OWNER', locale, role: 'employer', notify_status: false, notify_applications: false },
          { id: 'M2', locale: 'en', role: 'employer', notify_status: true },
          {
            id: 'CAND',
            locale: 'ar',
            role: 'candidate',
            full_name: 'منى <script>',
            whatsapp_phone: '+201012345678',
            email: 'secret-candidate@example.com',
          },
        ],
        profile_private: ['OWNER', 'M2'].map((user_id) => ({ user_id, unsubscribe_token: `t-${user_id}` })),
        company_members: [
          { company_id: 'C', user_id: 'OWNER' },
          { company_id: 'C', user_id: 'M2' },
        ],
      };
    }

    reset();
    globalThis.__db = { jobs: [listing()], ...people() };
    const first = await notifyBrokerOfJobApproval('J');
    const replay = await notifyBrokerOfJobApproval('J');
    ok('the owner is emailed even with status notices off', first === 'sent', first);
    ok('publishing the same approval again sends nothing', replay === 'skipped', replay);
    const ownerMail = mail.sends.filter((send) => send.to.startsWith('OWNER@') && send.template === 'job_approved_owner');
    ok('one approval message', ownerMail.length === 1, String(ownerMail.length));
    ok('the job title cannot become markup', ownerMail[0].html.includes('مستشار &lt;أول&gt;') && !ownerMail[0].html.includes('<أول>'));
    ok('approval is rtl arabic', ownerMail[0].html.includes('lang="ar"') && ownerMail[0].html.includes('dir="rtl"'));
    ok('approval is not optional', ownerMail[0].unsubscribe == null && !ownerMail[0].html.includes('/unsubscribe'));
    ok('approval subject', ownerMail[0].subject === 'تمت الموافقة على «مستشار <أول>»');
    ok(
      'approval heading and body',
      ownerMail[0].text.includes('تمت الموافقة على إعلانك') &&
        ownerMail[0].text.includes('«مستشار <أول>» ظاهر للمرشحين الآن. ستصلك رسالة عند كل تقديم جديد.'),
    );
    const preference = renderPreview('job_approved', 'ar', 'default');
    ok('the shared approval mail still says it was published', preference.subject === 'تم نشر «مستشار عقاري أول»' && preference.text.includes('تم نشر إعلانك'));

    await notifyEmployerOfModeration('J', true);
    ok(
      'the owner is not also sent the preference copy',
      mail.sends.filter((send) => send.to.startsWith('OWNER@')).length === 1,
    );
    ok(
      'a colleague with the preference on still hears',
      mail.sends.some((send) => send.to.startsWith('M2@') && send.template === 'job_approved'),
    );

    globalThis.__db.jobs[0].version = 8;
    const later = await notifyBrokerOfJobApproval('J');
    const laterAgain = await notifyBrokerOfJobApproval('J');
    ok('a later version is a new approval and sends once', later === 'sent', later);
    ok('that later approval is not sent twice', laterAgain === 'skipped', laterAgain);

    reset();
    globalThis.__db = { jobs: [listing({ status: 'pending_review' })], ...people() };
    ok('a listing that is not live is not announced as approved', (await notifyBrokerOfJobApproval('J')) === 'skipped');

    reset();
    globalThis.__db = { jobs: [listing()], ...people() };
    mail.provider = () => 'failed';
    const failed = await notifyBrokerOfJobApproval('J');
    ok('a provider failure is reported, not thrown', failed === 'failed', failed);
    mail.provider = () => 'sent';
    const key = [...mail.rows.keys()].find((item) => item.startsWith('job_approved_owner:'));
    mail.retry = { key };
    const retried = await notifyBrokerOfJobApproval('J');
    mail.retry = null;
    ok('the retry sends that approval once', retried === 'sent' && mail.sends.filter((send) => send.outcome === 'sent').length === 1, retried);
    const wrongPerson = await REBUILDERS.job_approved_owner('J', 'M2');
    ok('a retry recorded for somebody else sends nothing', wrongPerson === 'skipped', wrongPerson);

    reset();
    globalThis.__db = { jobs: () => { throw new Error('db down'); } };
    let threw = false;
    let broken = 'sent';
    try {
      broken = await notifyBrokerOfJobApproval('J');
    } catch {
      threw = true;
    }
    ok('a failed read does not break the approval', !threw && broken === 'failed', `${threw} ${broken}`);

    reset();
    globalThis.__db = {
      jobs: [listing()],
      applications: [
        {
          id: 'A1',
          status: 'withdrawn',
          candidate_id: 'CAND',
          cv_path: 'CAND/secret-cv.pdf',
          note: 'واتساب +201099988877',
          job: listing(),
        },
      ],
      ...people('en'),
    };
    const withdrew = await notifyBrokerOfWithdrawal('A1');
    const withdrewAgain = await notifyBrokerOfWithdrawal('A1');
    ok('the owner is told the candidate withdrew', withdrew === 'sent', withdrew);
    ok('the same withdrawal is not sent twice', withdrewAgain === 'skipped', withdrewAgain);
    const body = mail.sends.map((send) => `${send.subject}\n${send.text}\n${send.html}`).join('\n');
    const html = mail.sends.map((send) => send.html).join('\n');
    ok('english withdrawal subject', mail.sends[0].subject === 'A candidate withdrew from "Consultant"');
    ok('the display name is in the message', html.includes('منى &lt;script&gt;') && body.includes('منى <script>'));
    ok('the name cannot become markup', html.includes('&lt;script&gt;') && !html.includes('<script>'));
    for (const secret of ['+201012345678', 'secret-candidate@example.com', 'CAND/secret-cv.pdf', '+201099988877']) {
      ok(`withdrawal omits ${secret}`, !body.includes(secret));
    }
    ok('withdrawal is not optional', mail.sends[0].unsubscribe == null);
    ok('withdrawal points at the applicants page', body.includes('https://brokers.example/employer/jobs/J/applicants'));

    globalThis.__db.applications[0].status = 'shortlisted';
    reset();
    globalThis.__db = {
      applications: [{ id: 'A2', status: 'shortlisted', candidate_id: 'CAND', job: listing() }],
      ...people(),
    };
    ok('a standing application is not announced as withdrawn', (await notifyBrokerOfWithdrawal('A2')) === 'skipped');

    reset();
    globalThis.__db = {
      applications: [
        {
          id: 'A3',
          status: 'withdrawn',
          candidate_id: 'CAND',
          job: listing({ company: { id: 'C', owner_id: 'OWNER', name_ar: 'الرواد', suspended_at: '2026-10-01T00:00:00Z' } }),
        },
      ],
      ...people(),
    };
    const suspended = await notifyBrokerOfWithdrawal('A3');
    ok('a suspended company is not handed the name', suspended === 'skipped' && mail.sends.length === 0, suspended);

    reset();
    globalThis.__db = {
      applications: () => ({ data: null, error: { code: '57014', message: 'timeout' } }),
    };
    let withdrewThrew = false;
    let withdrewBroken = 'sent';
    try {
      withdrewThrew = false;
      withdrewBroken = await notifyBrokerOfWithdrawal('A9');
    } catch {
      withdrewThrew = true;
    }
    ok('a failed withdrawal read does not throw', !withdrewThrew && withdrewBroken === 'failed', `${withdrewThrew} ${withdrewBroken}`);

    // No admin/owner notify address exists in the product, so the copy is off
    // until OWNER_NOTIFY_EMAIL is set. It is never a hardcoded inbox.
    process.env.OWNER_NOTIFY_EMAIL = 'platform-owner@brokersconnect.net';
    reset();
    globalThis.__db = {
      jobs: [listing()],
      applications: [
        {
          id: 'A1',
          status: 'withdrawn',
          candidate_id: 'CAND',
          cv_path: 'CAND/secret-cv.pdf',
          note: 'واتساب +201099988877',
          job: listing(),
        },
      ],
      ...people('ar'),
    };
    const copiedApproval = await notifyBrokerOfJobApproval('J');
    const copiedApprovalAgain = await notifyBrokerOfJobApproval('J');
    const approvalTos = mail.sends.filter((send) => send.template === 'job_approved_owner').map((send) => send.to);
    ok('approval also copies the platform owner', copiedApproval === 'sent' && approvalTos.includes('platform-owner@brokersconnect.net'), approvalTos.join(','));
    ok('the brokerage owner still receives the approval', approvalTos.includes('OWNER@example.test'));
    ok('the approval copy is not sent twice', copiedApprovalAgain === 'skipped' && approvalTos.length === 2, String(approvalTos.length));

    const copiedWithdrawal = await notifyBrokerOfWithdrawal('A1');
    const copiedWithdrawalAgain = await notifyBrokerOfWithdrawal('A1');
    const withdrawalSends = mail.sends.filter((send) => send.template === 'candidate_withdrew');
    ok('withdrawal also copies the platform owner', copiedWithdrawal === 'sent' && withdrawalSends.some((send) => send.to === 'platform-owner@brokersconnect.net'));
    ok('the withdrawal copy is not sent twice', copiedWithdrawalAgain === 'skipped' && withdrawalSends.length === 2, String(withdrawalSends.length));
    const copiedBody = withdrawalSends.map((send) => `${send.text}\n${send.html}`).join('\n');
    const copiedHtml = withdrawalSends.map((send) => send.html).join('\n');
    for (const secret of ['+201012345678', 'secret-candidate@example.com', 'CAND/secret-cv.pdf', '+201099988877']) {
      ok(`the withdrawal copy omits ${secret}`, !copiedBody.includes(secret));
    }
    ok('the copy cannot turn the name into markup', copiedHtml.includes('منى &lt;script&gt;') && !copiedHtml.includes('<script>'));

    reset();
    globalThis.__db = { jobs: [listing({ version: 6 })], ...people() };
    process.env.OWNER_NOTIFY_EMAIL = 'owner@example.test';
    const sameInbox = await notifyBrokerOfJobApproval('J');
    ok(
      'a copy to the brokerage owner’s own address is not a second email',
      sameInbox === 'sent' && mail.sends.length === 1 && mail.sends[0].to === 'OWNER@example.test',
      mail.sends.map((send) => send.to).join(','),
    );

    reset();
    globalThis.__db = { jobs: [listing({ version: 7 })], ...people() };
    process.env.OWNER_NOTIFY_EMAIL = 'not-an-address';
    const badCopy = await notifyBrokerOfJobApproval('J');
    ok('an unusable copy address does not drop the brokerage email', badCopy === 'sent' && mail.sends.length === 1, String(mail.sends.length));

    reset();
    globalThis.__db = { jobs: [listing({ version: 8 })], ...people() };
    process.env.OWNER_NOTIFY_EMAIL = 'platform-owner@brokersconnect.net';
    mail.provider = (spec) => (spec.to === 'platform-owner@brokersconnect.net' ? 'failed' : 'sent');
    const copyFailed = await notifyBrokerOfJobApproval('J');
    ok('a failed copy is reported without throwing', copyFailed === 'failed');
    mail.provider = () => 'sent';
    const copyKey = [...mail.rows.keys()].find((item) => item.endsWith(':copy'));
    mail.retry = { key: copyKey };
    const copyRetried = await notifyBrokerOfJobApproval('J', null);
    mail.retry = null;
    const afterRetry = mail.sends.filter((send) => send.outcome === 'sent').map((send) => send.to);
    ok('retrying the copy does not send the brokerage a second one', copyRetried === 'sent' && afterRetry.filter((to) => to.startsWith('OWNER@')).length === 1, afterRetry.join(','));
    ok('and the platform owner then receives it', afterRetry.includes('platform-owner@brokersconnect.net'));
  } finally {
    if (savedSupport === undefined) delete process.env.SUPPORT_EMAIL;
    else process.env.SUPPORT_EMAIL = savedSupport;
    if (savedOwner === undefined) delete process.env.OWNER_NOTIFY_EMAIL;
    else process.env.OWNER_NOTIFY_EMAIL = savedOwner;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
