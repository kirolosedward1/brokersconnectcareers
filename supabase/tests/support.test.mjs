/**
 * Support: the reference a reader is shown, the request they send, and what an
 * admin may learn while answering it. Run with: pnpm test:support
 *
 * Most of what matters here is an effect — a row written, a notification
 * rung once and not twice — and the policy runner rolls every call back, so
 * these tests open their own transaction, act as somebody, then read back as
 * the database owner before rolling back. The runner is still used where the
 * question is only "was this allowed".
 */
import { createTestDb, runner, reporter, FIXTURES, USERS } from './setup.mjs';

const report = reporter();
const db = await createTestDb();
const as = runner(db);

const { employerVerified, employerUnverified, candidate, publicAgent, admin } = FIXTURES;

/** One transaction, always rolled back, whatever `body` does. */
async function tx(body) {
  await db.exec('begin');
  try {
    return await body();
  } finally {
    await db.exec('rollback');
  }
}

/** Act as somebody for the rest of the transaction. `null` is signed out. */
async function become(userId) {
  if (userId) {
    await db.exec(`set local role authenticated`);
    await db.exec(`set local request.jwt.claim.sub = '${userId}'`);
  } else {
    await db.exec(`set local role anon`);
    await db.exec(`set local request.jwt.claim.sub = ''`);
  }
}

/** Back to the owner, to read what happened with RLS out of the way. */
async function owner() {
  await db.exec('reset role');
}

/**
 * One statement inside the open transaction, behind a savepoint — a refusal
 * would otherwise abort the transaction and every later step would fail for a
 * reason that has nothing to do with it.
 */
async function attempt(sql) {
  await db.exec('savepoint step');
  try {
    const result = await db.query(sql);
    await db.exec('release savepoint step');
    return { ok: true, rows: result.rows };
  } catch (error) {
    await db.exec('rollback to savepoint step');
    return { ok: false, error: error.message, rows: [] };
  }
}

const event = (reference, extra = '') =>
  `select public.record_support_event('${reference}', 'server', 'apply',
     'application refused', '42501', '/jobs/some-listing/apply?next=%2Fsecret#access_token=x',
     '{"job": "abc"}'::jsonb, null, 'Chrome 128 · Android 14 · mobile', 'ar', 'abc1234'${extra}) as ok`;

report.section('a failure is recorded under the reference the reader saw');
{
  await tx(async () => {
    await become(candidate);
    const recorded = await attempt(event('BC-7K3M-9QX2'));
    await owner();
    const { rows } = await db.query(`select * from support_events where reference = 'BC-7K3M-9QX2'`);
    const row = rows[0];

    report.check('a signed-in caller can record one', recorded.ok && recorded.rows[0].ok === true,
      recorded.error);
    report.check('the account comes from the session, not the call', row?.user_id === candidate);
    report.check('and the role is the one on the profile', row?.role === 'candidate', row?.role);
    report.check('the route keeps its path and loses its query and fragment',
      row?.route === '/jobs/some-listing/apply', row?.route);
    report.check('identifiers survive as they were sent', row?.detail?.job === 'abc');
  });

  await tx(async () => {
    await become(null);
    const recorded = await attempt(event('BC-0000-0001'));
    await owner();
    const { rows } = await db.query(`select user_id, role from support_events where reference = 'BC-0000-0001'`);
    report.check('a signed-out caller can record one too', recorded.ok && rows.length === 1, recorded.error);
    report.check('with no account and no role', rows[0]?.user_id === null && rows[0]?.role === null);
  });

  await tx(async () => {
    await become(candidate);
    const first = await attempt(event('BC-AAAA-BBBB'));
    const again = await attempt(event('BC-AAAA-BBBB'));
    await owner();
    const { rows } = await db.query(`select count(*)::int as n from support_events where reference = 'BC-AAAA-BBBB'`);
    report.check('a report re-sent from the offline queue is not recorded twice',
      first.rows[0]?.ok === true && again.rows[0]?.ok === false && rows[0].n === 1,
      JSON.stringify({ first: first.rows[0], again: again.rows[0], n: rows[0].n }));
  });

  const malformed = await as(candidate, event('BC-IIII-OOOO'));
  report.check('a malformed reference is refused loudly',
    !malformed.ok && /invalid_reference/.test(malformed.error ?? ''), malformed.error);

  const badArea = await as(candidate, `select public.record_support_event('BC-1111-2222', 'server', 'Drop Table', 'x')`);
  report.check('and so is an area that is not a plain name',
    !badArea.ok && /invalid_area/.test(badArea.error ?? ''), badArea.error);

  await tx(async () => {
    await become(candidate);
    const huge = JSON.stringify({ blob: 'x'.repeat(5000) });
    await attempt(`select public.record_support_event('BC-3333-4444', 'client', 'upload', 'too much', null, null, '${huge}'::jsonb)`);
    await owner();
    const { rows } = await db.query(`select detail from support_events where reference = 'BC-3333-4444'`);
    report.check('an oversized detail is replaced, not stored and not fatal',
      rows[0]?.detail?.truncated === true, JSON.stringify(rows[0]?.detail).slice(0, 80));
  });
}

report.section('nobody but an admin reads the log, and nobody writes it directly');
{
  await db.exec(`insert into support_events (reference, source, area, event, user_id)
                 values ('BC-READ-0001', 'server', 'apply', 'seeded', '${candidate}')`);

  const self = await as(candidate, `select * from support_events where reference = 'BC-READ-0001'`);
  report.check('not even the account the failure happened to', self.ok && self.rows.length === 0,
    self.error ?? `${self.rows.length} rows`);

  const stranger = await as(null, `select * from support_events`, 'anon');
  report.check('nor anybody signed out', stranger.ok && stranger.rows.length === 0,
    stranger.error ?? `${stranger.rows.length} rows`);

  const staff = await as(admin, `select * from support_events where reference = 'BC-READ-0001'`);
  report.check('an admin does', staff.ok && staff.rows.length === 1, staff.error);

  const forged = await as(candidate, `
    insert into support_events (reference, source, area, event, user_id)
    values ('BC-FAKE-0001', 'server', 'apply', 'forged', '${employerVerified}')`);
  report.check('a direct insert is refused, so nobody can file one in somebody else\'s name',
    !forged.ok, forged.ok ? 'insert was allowed' : forged.error);

  await db.exec(`delete from support_events where reference = 'BC-READ-0001'`);
}

report.section('the log cannot be flooded, and forgets after ninety days');
{
  await tx(async () => {
    await owner();
    await db.exec(`
      insert into support_events (reference, source, area, event, user_id)
      select 'BC-' || upper(lpad(to_hex(g), 4, '0')) || '-0000', 'client', 'apply', 'flood', '${candidate}'
        from generate_series(4096, 4096 + 29) g`);
    await become(candidate);
    const refused = await attempt(event('BC-FFFF-FFFF'));
    report.check('the thirty-first report from one account in ten minutes is dropped',
      refused.ok && refused.rows[0]?.ok === false, JSON.stringify(refused.rows[0] ?? refused.error));

    await become(publicAgent);
    const other = await attempt(event('BC-FFFF-FFFE'));
    report.check('while another account is unaffected', other.rows[0]?.ok === true,
      JSON.stringify(other.rows[0] ?? other.error));
  });

  await tx(async () => {
    await owner();
    await db.exec(`
      insert into support_events (reference, source, area, event)
      select 'BC-' || upper(lpad(to_hex(g), 4, '0')) || '-1111', 'exception', 'render', 'flood'
        from generate_series(4096, 4096 + 199) g`);
    await become(null);
    const refused = await attempt(event('BC-FFFF-FFFD'));
    report.check('the signed-out side shares one ceiling',
      refused.ok && refused.rows[0]?.ok === false, JSON.stringify(refused.rows[0] ?? refused.error));

    await become(candidate);
    const signedIn = await attempt(event('BC-FFFF-FFFC'));
    report.check('and a flood of it does not silence signed-in accounts',
      signedIn.rows[0]?.ok === true, JSON.stringify(signedIn.rows[0] ?? signedIn.error));
  });

  await tx(async () => {
    await owner();
    await db.exec(`
      insert into support_events (reference, source, area, event, occurred_at)
      values ('BC-01D0-0001', 'server', 'apply', 'ancient', now() - interval '100 days'),
             ('BC-01D0-0002', 'server', 'apply', 'recent',  now() - interval '80 days')`);
    await become(candidate);
    await attempt(event('BC-01D0-0003'));
    await owner();
    const { rows } = await db.query(`
      select reference from support_events where reference like 'BC-01D0-%' order by reference`);
    const left = rows.map((row) => row.reference);
    report.check('a row older than ninety days is swept by the next write',
      !left.includes('BC-01D0-0001'), left.join(', '));
    report.check('and one inside the window is kept', left.includes('BC-01D0-0002'), left.join(', '));
  });
}

report.section('a help request carries its own context, and only once');
{
  const KEY = '0b7c1a44-2f11-4e6e-9d7a-5f0e8a1c2b3d';
  const send = (key, extra = {}) => {
    const topic = extra.topic ?? 'apply';
    const message = extra.message ?? 'قدّمت على الوظيفة وظهرلي خطأ ومش عارف الطلب وصل ولا لأ';
    const email = extra.email ? `'${extra.email}'` : 'null';
    const errorRef = extra.errorRef ? `'${extra.errorRef}'` : 'null';
    return `select public.submit_support_request('${key}', '${topic}', '${message}', ${errorRef},
              ${email}, '/jobs/x/apply?token=secret', 'Safari 17 · iOS 17 · mobile', 'ar', 'abc1234') as reference`;
  };

  await tx(async () => {
    await become(candidate);
    const first = await attempt(send(KEY, { email: 'someone@example.com', errorRef: 'BC-7K3M-9QX2' }));
    const retry = await attempt(send(KEY, { email: 'someone@example.com', errorRef: 'BC-7K3M-9QX2' }));
    await owner();
    const { rows } = await db.query(`select * from support_requests where request_key = '${KEY}'`);
    const row = rows[0];

    report.check('a signed-in request is answered with a reference',
      first.ok && /^BC-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(first.rows[0]?.reference ?? ''), first.error);
    report.check('a retry with the same key returns the same request',
      retry.ok && retry.rows[0]?.reference === first.rows[0]?.reference && rows.length === 1,
      retry.error ?? `${rows.length} rows`);
    report.check('the account and its role are attached by the platform',
      row?.user_id === candidate && row?.role === 'candidate');
    report.check('a signed-in account\'s address is never copied onto the request',
      row?.contact_email === null, row?.contact_email);
    report.check('the failure it is about is attached', row?.error_reference === 'BC-7K3M-9QX2');
    report.check('and the page is kept without its query', row?.route === '/jobs/x/apply', row?.route);
  });

  await tx(async () => {
    await become(null);
    const nobody = await attempt(send('11111111-1111-4111-8111-111111111111'));
    report.check('a signed-out request with no way to answer it is refused',
      !nobody.ok && /contact_required/.test(nobody.error ?? ''), nobody.error);

    const reachable = await attempt(send('22222222-2222-4222-8222-222222222222', {
      topic: 'login', email: '  Lost.User@Example.com ',
    }));
    await owner();
    const { rows } = await db.query(`
      select user_id, role, contact_email from support_requests
       where request_key = '22222222-2222-4222-8222-222222222222'`);
    report.check('one with an address goes through', reachable.ok && rows.length === 1, reachable.error);
    report.check('keeping the address, tidied, as the only way back to them',
      rows[0]?.contact_email === 'lost.user@example.com' && rows[0]?.user_id === null,
      JSON.stringify(rows[0]));
  });

  const short = await as(candidate, `select public.submit_support_request(
    '33333333-3333-4333-8333-333333333333', 'apply', 'help', null, null, null, null, null, null)`);
  report.check('a message too short to act on is refused by name',
    !short.ok && /message_short/.test(short.error ?? ''), short.error);

  const topic = await as(candidate, `select public.submit_support_request(
    '44444444-4444-4444-8444-444444444444', 'refund', 'أريد استرداد المبلغ من فضلك', null, null, null, null, null, null)`);
  report.check('and so is a topic the product does not have',
    !topic.ok && /invalid_topic/.test(topic.error ?? ''), topic.error);

  await tx(async () => {
    await become(candidate);
    const keys = [1, 2, 3, 4, 5].map((n) => `55555555-5555-4555-8555-00000000000${n}`);
    for (const key of keys) await attempt(send(key));
    const sixth = await attempt(send('55555555-5555-4555-8555-000000000006'));
    report.check('the sixth request from one account in a day is refused',
      !sixth.ok && /support_rate_limit/.test(sixth.error ?? ''), sixth.error ?? 'allowed');

    const retryAtLimit = await attempt(send(keys[4]));
    report.check('but a retry of one already sent still gets its answer',
      retryAtLimit.ok && /^BC-/.test(retryAtLimit.rows[0]?.reference ?? ''), retryAtLimit.error);

    await become(employerVerified);
    const stolen = await attempt(send(keys[0]));
    report.check('somebody else\'s key is refused rather than answered with their request',
      !stolen.ok, JSON.stringify(stolen.rows[0] ?? stolen.error));
  });
}

report.section('a request is read by its sender and by admins');
{
  await db.exec(`
    insert into support_requests (reference, request_key, user_id, role, topic, message)
    values ('BC-REQ0-0001', '66666666-6666-4666-8666-666666666666', '${candidate}', 'candidate',
            'apply', 'رسالة تجريبية للاختبار')`);

  const mine = await as(candidate, `select reference from support_requests`);
  report.check('the sender sees their own', mine.ok && mine.rows.some((r) => r.reference === 'BC-REQ0-0001'),
    mine.error);

  const theirs = await as(employerVerified, `select reference from support_requests where reference = 'BC-REQ0-0001'`);
  report.check('another account does not', theirs.ok && theirs.rows.length === 0, theirs.error);

  const anon = await as(null, `select reference from support_requests`, 'anon');
  report.check('nor does anybody signed out', anon.ok && anon.rows.length === 0, anon.error);

  const staff = await as(admin, `select reference from support_requests where reference = 'BC-REQ0-0001'`);
  report.check('an admin does', staff.ok && staff.rows.length === 1, staff.error);

  const edit = await as(candidate, `update support_requests set status = 'closed' where reference = 'BC-REQ0-0001' returning id`);
  report.check('and the sender cannot close or rewrite it', !edit.ok || edit.rows.length === 0,
    edit.error ?? `${edit.rows.length} rows`);
}

report.section('an answer rings the bell once');
{
  const id = (await db.query(`select id from support_requests where reference = 'BC-REQ0-0001'`)).rows[0].id;

  const refused = await as(candidate, `select public.admin_answer_support_request('${id}', 'تم', 'answered')`);
  report.check('only an admin can answer', !refused.ok && /forbidden/.test(refused.error ?? ''), refused.error);

  const empty = await as(admin, `select public.admin_answer_support_request('${id}', '  ', 'answered')`);
  report.check('an answer needs words', !empty.ok && /reply_required/.test(empty.error ?? ''), empty.error);

  await tx(async () => {
    await become(admin);
    const reply = 'راجعنا طلبك: التقديم وصل للشركة بتاريخ اليوم، ومش محتاج تقدّم تاني.';
    const first = await attempt(`select public.admin_answer_support_request('${id}', '${reply}', 'answered') as status`);
    const again = await attempt(`select public.admin_answer_support_request('${id}', '${reply}', 'answered') as status`);
    await owner();
    const { rows: bells } = await db.query(`
      select payload from notifications where user_id = '${candidate}' and kind = 'support_replied'`);
    const { rows } = await db.query(`select status, reply, replied_by from support_requests where id = '${id}'`);

    report.check('the request is answered and says by whom',
      first.rows[0]?.status === 'answered' && rows[0]?.replied_by === admin, first.error);
    report.check('the sender is told once, and saving the same answer twice does not tell them again',
      bells.length === 1, `${bells.length} notifications`);
    report.check('the notification names the request it answers',
      bells[0]?.payload?.reference === 'BC-REQ0-0001', JSON.stringify(bells[0]?.payload));

    await become(admin);
    await attempt(`select public.admin_answer_support_request('${id}', 'تحديث: الشركة شافت طلبك.', 'answered')`);
    await owner();
    const { rows: after } = await db.query(`
      select count(*)::int as n from notifications where user_id = '${candidate}' and kind = 'support_replied'`);
    report.check('a different answer is news, and is told', after[0].n === 2, `${after[0].n} notifications`);

    await become(admin);
    const closed = await attempt(`select public.admin_answer_support_request('${id}', null, 'closed') as status`);
    await owner();
    const { rows: final } = await db.query(`
      select count(*)::int as n from notifications where user_id = '${candidate}' and kind = 'support_replied'`);
    report.check('closing without a new answer notifies nobody',
      closed.rows[0]?.status === 'closed' && final[0].n === 2, `${final[0].n} notifications`);
  });

  await db.exec(`delete from support_requests where reference = 'BC-REQ0-0001'`);
}

report.section('what support may learn about one account');
{
  await db.exec(`
    update auth.users
       set confirmation_sent_at = now() - interval '2 days',
           recovery_sent_at     = now() - interval '1 hour',
           last_sign_in_at      = now() - interval '3 days',
           raw_app_meta_data    = '{"provider": "email", "providers": ["email"]}'
     where id = '${employerUnverified}';
    insert into support_events (reference, source, area, event, user_id, route)
    values ('BC-FACT-0001', 'server', 'listing', 'save refused', '${employerUnverified}', '/employer/jobs/new');
  `);

  const refused = await as(candidate, `select public.admin_support_facts('employer2@demo.test')`);
  report.check('only an admin can look', !refused.ok && /forbidden/.test(refused.error ?? ''), refused.error);

  const anon = await as(null, `select public.admin_support_facts('employer2@demo.test')`, 'anon');
  report.check('and not at all while signed out', !anon.ok, anon.ok ? 'allowed' : anon.error);

  const byEmail = await as(admin, `select public.admin_support_facts('  Employer2@Demo.test ') as f`);
  const facts = byEmail.rows[0]?.f;
  report.check('an account is found by the address somebody wrote from',
    byEmail.ok && facts?.found === true && facts?.user_id === employerUnverified, byEmail.error);
  report.check('with when the last reset link was sent and when they last got in',
    Boolean(facts?.auth?.recovery_sent_at) && Boolean(facts?.auth?.last_sign_in_at));
  report.check('and how they sign in', JSON.stringify(facts?.auth?.providers) === '["email"]',
    JSON.stringify(facts?.auth?.providers));
  report.check('the company, its papers and its listings are there',
    facts?.company?.verification_status === 'unverified' && typeof facts?.company?.jobs_by_status === 'object',
    JSON.stringify(facts?.company)?.slice(0, 120));
  report.check('and what failed for them', facts?.events?.some((e) => e.reference === 'BC-FACT-0001'));

  const text = JSON.stringify(facts ?? {});
  report.check('the answer never carries an address, a number or a file path',
    !/@demo\.test|\+20\d|storage_path|cv_path|whatsapp_phone/.test(text),
    text.match(/@demo\.test|\+20\d+|storage_path|cv_path|whatsapp_phone/)?.[0] ?? '');

  const byId = await as(admin, `select public.admin_support_facts('${publicAgent}') as f`);
  report.check('an account id finds the account too', byId.rows[0]?.f?.user_id === publicAgent);
  report.check('with the directory profile as settings, and whether a CV exists as a yes or no',
    typeof byId.rows[0]?.f?.agent?.visibility === 'string' && typeof byId.rows[0]?.f?.agent?.has_cv === 'boolean',
    JSON.stringify(byId.rows[0]?.f?.agent));

  const byPhone = await as(admin, `select public.admin_support_facts('01009876543') as f`);
  report.check('the WhatsApp number somebody messaged from finds them, typed the local way',
    byPhone.rows[0]?.f?.user_id === employerUnverified, JSON.stringify(byPhone.rows[0]?.f)?.slice(0, 120));

  const nobody = await as(admin, `select public.admin_support_facts('nobody@nowhere.test') as f`);
  report.check('an address with no account says so plainly',
    nobody.rows[0]?.f?.found === false && nobody.rows[0]?.f?.reason === 'none', JSON.stringify(nobody.rows[0]?.f));

  const fragment = await as(admin, `select public.admin_support_facts('أحمد') as f`);
  report.check('a name fragment is not a lookup, so this never becomes a directory',
    fragment.rows[0]?.f?.found === false && fragment.rows[0]?.f?.reason === 'query',
    JSON.stringify(fragment.rows[0]?.f));

  const onboarding = USERS.candidate7;
  await db.exec(`
    insert into auth.users (id, email) values ('77777777-7777-4777-8777-777777777777', 'halfway@demo.test')`);
  const halfway = await as(admin, `select public.admin_support_facts('halfway@demo.test') as f`);
  report.check('an account that never finished onboarding is found, with no profile to show',
    halfway.rows[0]?.f?.found === true && halfway.rows[0]?.f?.profile === null
      && halfway.rows[0]?.f?.company === null,
    halfway.error ?? JSON.stringify(halfway.rows[0]?.f)?.slice(0, 160));
  void onboarding;

  await db.exec(`
    delete from support_events where reference = 'BC-FACT-0001';
    delete from auth.users where id = '77777777-7777-4777-8777-777777777777';`);
}

report.section('deleting an account keeps its failures, without the account');
{
  await db.exec(`
    insert into auth.users (id, email) values ('88888888-8888-4888-8888-888888888888', 'leaving@demo.test');
    insert into support_events (reference, source, area, event, user_id)
      values ('BC-G0NE-0001', 'server', 'account', 'delete failed', '88888888-8888-4888-8888-888888888888');
    insert into support_requests (reference, request_key, user_id, topic, message)
      values ('BC-G0NE-0002', '99999999-9999-4999-8999-999999999999',
              '88888888-8888-4888-8888-888888888888', 'other', 'أريد حذف حسابي من فضلك');
  `);
  // Outside any transaction on purpose: the delete is the thing being tested,
  // and its cascades have to really run.
  let removed = { ok: true };
  try {
    await db.query(`delete from auth.users where id = '88888888-8888-4888-8888-888888888888'`);
  } catch (error) {
    removed = { ok: false, error: error.message };
  }
  const { rows } = await db.query(`
    select (select user_id from support_events where reference = 'BC-G0NE-0001') as event_user,
           (select user_id from support_requests where reference = 'BC-G0NE-0002') as request_user`);
  report.check('the account can still be deleted', removed.ok, removed.error);
  report.check('and what it reported stays, anonymised',
    rows[0].event_user === null && rows[0].request_user === null, JSON.stringify(rows[0]));

  await db.exec(`
    delete from support_events where reference = 'BC-G0NE-0001';
    delete from support_requests where reference = 'BC-G0NE-0002';`);
}

process.exit(report.finish() ? 0 : 1);
