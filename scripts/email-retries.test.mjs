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

const { notifyCompanyVerification, notifyVisibilityChanged } = await import('../src/lib/email/notify.ts');
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
  function company({ members, version, decisions, papers = [] }) {
    globalThis.__db = {
      companies: [{ id: 'C', slug: 'al-rowad', name_ar: 'الرواد', name_en: 'Al Rowad', owner_id: members[0], logo_url: null, version }],
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
  // A sends papers again: the company is in review once more, its version bumped.
  globalThis.__db.companies[0].version = 6;
  mail.provider = () => 'sent';
  mail.retry = { key: failed.key };
  await REBUILDERS.company_verification_needed('C', 'B');
  mail.retry = null;
  const toA = mail.sends.filter((send) => send.to.startsWith('A@') && send.outcome === 'sent').length;
  const toB = mail.sends.filter((send) => send.to.startsWith('B@') && send.outcome === 'sent').length;
  ok('the member it reached is not sent it again', toA === 1, `A received ${toA}`);
  ok('the member it missed is', toB === 1, `B received ${toB}`);

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
