/**
 * The email system's load-bearing rules.
 *
 * Four things here would be silent if they broke, and expensive:
 *
 *   escaping     — a job title is typed by an employer and rendered into HTML
 *                  that lands in somebody's webmail
 *   signatures   — the delivery webhook can suppress any address on the
 *                  platform, which is a denial-of-service against password
 *                  resets if it accepts an unsigned body
 *   idempotency  — the spec's own word is "critical": a retried event must not
 *                  produce a second email
 *   coverage     — a template added to notify.ts without a preview is a
 *                  template nobody looks at until a user does
 *
 * Run with: pnpm test:email
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb, reporter } from './setup.mjs';
import { escape as escapeHtml, safeHref } from '../../src/lib/email/components.ts';
import { verifySvix } from '../../src/lib/email/svix.ts';
import { eventKind } from '../../src/lib/email/events.ts';
import { senderProblem } from '../../src/lib/email/sender.ts';
import { TEMPLATES } from '../../src/lib/email/templates.ts';

const base = reporter();
const report = {
  ...base,
  /** Equality, phrased so a failure prints what it actually got. */
  is(actual, expected, label) {
    base.check(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  },
  ok(condition, label) {
    base.check(label, Boolean(condition));
  },
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

report.section('user content cannot become markup');

report.is(escapeHtml('<script>alert(1)</script>'),
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  'a script tag in a job title is inert',
);

report.is(escapeHtml('Sales " onmouseover="x'),
  'Sales &quot; onmouseover=&quot;x',
  'a double quote cannot break out of an attribute',
);

report.is(escapeHtml("O'Brien & Co <Cairo>"),
  'O&#39;Brien &amp; Co &lt;Cairo&gt;',
  'a single quote cannot break out of an attribute either',
);

// The ampersand must be replaced first or every other entity gets double
// encoded — &lt; would come out as &amp;lt; and render as literal "&lt;".
report.is(escapeHtml('a & b < c'), 'a &amp; b &lt; c', 'entities are not double encoded');

report.is(escapeHtml('مستشار عقاري <أول>'),
  'مستشار عقاري &lt;أول&gt;',
  'Arabic passes through unchanged apart from the markup',
);

report.section('hrefs');

report.is(safeHref('https://www.brokersconnect.net/jobs'), 'https://www.brokersconnect.net/jobs', 'https is allowed');
report.is(safeHref('mailto:hello@brokersconnect.net'), 'mailto:hello@brokersconnect.net', 'mailto is allowed');
report.is(safeHref('javascript:alert(1)'), '#', 'javascript: is refused');
report.is(safeHref('  JavaScript:alert(1)'), '#', 'refused with whitespace and mixed case');
report.is(safeHref('data:text/html,<script>'), '#', 'data: is refused');
report.is(safeHref('/relative/path'), '#', 'a relative path is refused — email has no origin');
report.is(safeHref('https://x.test/a"onload="y'),
  'https://x.test/a&quot;onload=&quot;y',
  'an allowed scheme is still escaped',
);

// ---------------------------------------------------------------------------
// Webhook signatures
// ---------------------------------------------------------------------------

report.section('the delivery webhook only trusts a valid signature');

const SECRET = 'whsec_' + Buffer.from('a-test-signing-key-32-bytes-long').toString('base64');
const ID = 'msg_2abc';
const BODY = JSON.stringify({ type: 'email.delivered', data: { email_id: 'e1' } });

function sign(id, timestamp, body, secret = SECRET) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return 'v1,' + createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
}

const now = Date.now();
const ts = String(Math.floor(now / 1000));

report.ok(
  verifySvix({ secret: SECRET, id: ID, timestamp: ts, signatureHeader: sign(ID, ts, BODY), body: BODY, now }),
  'a correctly signed payload verifies',
);

report.ok(
  !verifySvix({ secret: SECRET, id: ID, timestamp: ts, signatureHeader: sign(ID, ts, BODY), body: BODY + ' ', now }),
  'one extra byte in the body fails — the signature is over what was sent',
);

report.ok(
  !verifySvix({ secret: SECRET, id: 'msg_other', timestamp: ts, signatureHeader: sign(ID, ts, BODY), body: BODY, now }),
  'the message id is part of the signed content',
);

report.ok(
  !verifySvix({ secret: SECRET, id: ID, timestamp: ts, signatureHeader: sign(ID, ts, BODY, 'whsec_' + Buffer.from('wrong-key').toString('base64')), body: BODY, now }),
  'a signature from a different key fails',
);

report.ok(
  !verifySvix({ secret: SECRET, id: ID, timestamp: ts, signatureHeader: null, body: BODY, now }),
  'a missing signature header fails rather than passing',
);

report.ok(
  !verifySvix({ secret: '', id: ID, timestamp: ts, signatureHeader: sign(ID, ts, BODY), body: BODY, now }),
  'an unconfigured secret fails closed',
);

// Replay: a valid signature stays valid forever without a timestamp check, so
// a payload captured from the wire could be sent back a year later.
const old = String(Math.floor(now / 1000) - 3600);
report.ok(
  !verifySvix({ secret: SECRET, id: ID, timestamp: old, signatureHeader: sign(ID, old, BODY), body: BODY, now }),
  'an hour-old payload is refused even though its signature is genuine',
);

const future = String(Math.floor(now / 1000) + 3600);
report.ok(
  !verifySvix({ secret: SECRET, id: ID, timestamp: future, signatureHeader: sign(ID, future, BODY), body: BODY, now }),
  'a future timestamp is refused too',
);

// A secret being rotated means two valid signatures arrive at once.
report.ok(
  verifySvix({
    secret: SECRET,
    id: ID,
    timestamp: ts,
    signatureHeader: `v1,AAAA ${sign(ID, ts, BODY)}`,
    body: BODY,
    now,
  }),
  'any one of several signatures matching is enough, for key rotation',
);

// ---------------------------------------------------------------------------
// Coverage: every template that can be sent can be previewed
// ---------------------------------------------------------------------------

report.section('every template is reachable in the preview');

const notify = read('src/lib/email/notify.ts');
const preview = read('src/lib/email/preview.ts');

// The template names actually passed to deliver().
const sent = [...notify.matchAll(/template:\s*(?:\w+\s*\?\s*)?'([a-z_]+)'(?:\s*:\s*'([a-z_]+)')?/g)]
  .flatMap((match) => [match[1], match[2]])
  .filter(Boolean);

const previewed = new Set(
  [...preview.matchAll(/^ {2}([a-z_]+): \(f\) =>/gm)].map((match) => match[1]),
);

report.ok(sent.length >= 18, `notify.ts sends ${sent.length} distinct templates`);

const missing = [...new Set(sent)].filter((name) => !previewed.has(name));
report.is(missing.join(', ') || 'none', 'none', 'no template can be sent without a preview');

// And the other direction: a preview for something nothing sends is a template
// that was dropped from the product and left in the gallery, where it reads as
// a message users receive.
const orphaned = [...previewed].filter((name) => !sent.includes(name));
report.is(orphaned.join(', ') || 'none', 'none', 'no preview outlives the template it previews');

// ---------------------------------------------------------------------------
// Idempotency, against the real schema
// ---------------------------------------------------------------------------

report.section('idempotency');

const db = await createTestDb();

async function claim(key, template = 'application_receipt', to = 'someone@brokersconnect.net') {
  const { rows } = await db.query(
    'select public.claim_email($1, $2, $3, null, null, null) as id',
    [key, template, to],
  );
  return rows[0].id;
}

const first = await claim('application_receipt:app-1');
report.ok(Boolean(first), 'the first claim on a key returns a row to send');

const second = await claim('application_receipt:app-1');
report.is(second, null, 'the second claim on the same key sends nothing');

const { rows: counted } = await db.query(
  `select count(*)::int as n from email_log where dedupe_key = 'application_receipt:app-1'`,
);
report.is(counted[0].n, 1, 'and only one outbox row exists — no duplicate to sweep up later');

const other = await claim('application_receipt:app-2');
report.ok(Boolean(other) && other !== first, 'a different application is a different message');

// Null keys are the documented escape hatch for messages with no natural key.
// They must not collide with each other, which a unique index on a nullable
// column gives for free — and getting that wrong would silence every one of
// them after the first.
const nullA = await claim(null, 'account_rejected');
const nullB = await claim(null, 'account_rejected');
report.ok(Boolean(nullA) && Boolean(nullB) && nullA !== nullB, 'two unkeyed messages both send');

report.section('suppression');

await db.query(
  `insert into email_suppressions (email, reason) values ('bounced@brokersconnect.net', 'hard_bounce')`,
);

const suppressed = await claim('receipt:app-3', 'application_receipt', 'bounced@brokersconnect.net');
report.is(suppressed, null, 'a hard-bounced address is never written to again');

const { rows: sup } = await db.query(
  `select status, error from email_log where dedupe_key = 'receipt:app-3'`,
);
report.is(sup[0]?.status, 'suppressed', 'and the refusal is recorded rather than silent');

// Case is not a different mailbox for suppression purposes.
const cased = await claim('receipt:app-4', 'application_receipt', 'Bounced@BrokersConnect.net');
report.is(cased, null, 'suppression is case-insensitive on the address');

report.section('addresses that could never work');

// The seed's demo accounts live at demo.test, and .test is reserved by RFC
// 2606 so that it can never resolve. Mailing them is guaranteed bounce, and
// bounce rate is what every receiving provider scores a new sending domain on.
for (const address of [
  'candidate1@demo.test',
  'someone@example.com',
  'x@sub.invalid',
  'y@localhost',
]) {
  const attempt = await claim(`reserved:${address}`, 'welcome_candidate', address);
  report.is(attempt, null, `${address} is never attempted`);
}

const { rows: refused } = await db.query(
  `select status, error from email_log where dedupe_key = 'reserved:candidate1@demo.test'`,
);
report.is(refused[0]?.status, 'suppressed', 'and the refusal is on the record, not silent');

// Nothing legitimate may be caught by it.
for (const address of ['ahmed@brokersconnect.net', 'a@gmail.com', 'b@testing.co.uk', 'c@example.co']) {
  const attempt = await claim(`ok:${address}`, 'welcome_candidate', address);
  report.ok(Boolean(attempt), `${address} still sends`);
}

report.section('retry budget');

const target = await claim('status:app-9');
for (let attempt = 0; attempt < 3; attempt += 1) {
  await db.query(`select public.record_email_attempt($1, 'failed', null, 'boom', false)`, [target]);
}

const { rows: exhausted } = await db.query('select public.pending_emails(50) as row');
report.is(exhausted.filter((r) => r.row?.includes?.(target)).length,
  0,
  'a message that failed three times stops being retried',
);

const permanent = await claim('status:app-10');
await db.query(`select public.record_email_attempt($1, 'failed', null, '422 bad address', true)`, [
  permanent,
]);
const { rows: perm } = await db.query('select attempts from email_log where id = $1', [permanent]);
report.ok(perm[0].attempts >= 3, 'a permanent failure exhausts its budget on the first attempt');

report.section('delivered is only ever written by the webhook');

const delivered = await claim('receipt:app-11');
await db.query(`select public.record_email_attempt($1, 'sent', 'provider-abc', null, false)`, [
  delivered,
]);

const { rows: afterSend } = await db.query(
  'select status, sent_at, delivered_at from email_log where id = $1',
  [delivered],
);
report.is(afterSend[0].status, 'sent', 'accepting a message records `sent`, not `delivered`');
report.ok(afterSend[0].sent_at !== null, 'sent_at is stamped');
report.is(afterSend[0].delivered_at, null, 'delivered_at stays null until the webhook says otherwise');

const { rows: marked } = await db.query(
  `select public.mark_email_delivered('provider-abc', 'delivered') as n`,
);
report.is(marked[0].n, 1, 'the webhook matches the row by the provider id');

const { rows: afterHook } = await db.query(
  'select status, delivered_at from email_log where id = $1',
  [delivered],
);
report.is(afterHook[0].status, 'delivered', 'and only then is it delivered');
report.ok(afterHook[0].delivered_at !== null, 'with a timestamp of its own');

// A bounce and a delivery can both arrive for one message, out of order.
const bounced = await claim('receipt:app-12');
await db.query(`select public.record_email_attempt($1, 'sent', 'provider-xyz', null, false)`, [bounced]);
await db.query(`select public.mark_email_delivered('provider-xyz', 'bounced')`);
await db.query(`select public.mark_email_delivered('provider-xyz', 'delivered')`);
const { rows: raced } = await db.query('select status from email_log where id = $1', [bounced]);
report.is(raced[0].status, 'bounced', 'a late delivery event cannot overwrite a bounce');

const { rows: unknown } = await db.query(
  `select public.mark_email_delivered('never-sent-this', 'delivered') as n`,
);
report.is(unknown[0].n, 0, 'an event about a message we never sent matches nothing');

report.section('the outbox is closed to users');

for (const table of ['email_log', 'email_suppressions', 'email_webhook_events', 'rate_limit_hits']) {
  const { rows } = await db.query(
    `select relrowsecurity as on, (select count(*) from pg_policies where tablename = $1)::int as policies
       from pg_class where relname = $1`,
    [table],
  );
  report.ok(rows[0].on, `${table} has row-level security on`);
  report.is(rows[0].policies, 0, `${table} has no policies — deny-all, service role only`);
}


// ---------------------------------------------------------------------------
// Delivery events (migration 68)
// ---------------------------------------------------------------------------

report.section('webhook payloads are read the way the provider means them');

const ev = (type, extra = {}) => eventKind({ type, data: { email_id: 'p1', ...extra } });
report.is(ev('email.delivered')?.kind, 'delivered', 'delivered');
report.is(ev('email.bounced', { bounce: { type: 'Permanent' } })?.kind, 'bounced_hard', 'a permanent bounce is hard');
report.is(ev('email.bounced', { bounce: { type: 'Transient' } })?.kind, 'bounced_soft', 'a transient bounce is soft — a full inbox is not a dead address');
report.is(ev('email.bounced', { bounce: { type: 'Undetermined' } })?.kind, 'bounced_hard', 'an undetermined bounce is treated as hard');
report.is(ev('email.bounced')?.kind, 'bounced_hard', 'a bounce with no detail is treated as hard');
report.is(ev('email.complained')?.kind, 'complained', 'complained');
report.is(ev('email.failed')?.kind, 'failed', 'email.failed is no longer ignored');
report.is(ev('email.suppressed')?.kind, 'suppressed', 'email.suppressed is no longer ignored');
report.is(ev('email.delivery_delayed')?.kind, 'delayed', 'a delay is its own kind');
report.is(ev('email.opened'), null, 'opens are not tracked');
report.is(ev('email.sent'), null, 'sent is already known from the API response');
report.is(eventKind({ type: 'email.delivered', data: {} }), null, 'an event with no message id is ignored');
report.is(eventKind('nonsense'), null, 'a non-object is ignored');

report.section('no development sender in production');

report.is(senderProblem('Brokers Connect <noreply@brokersconnect.net>'), null, 'the branded sender is fine');
report.is(senderProblem('Lavista <onboarding@resend.dev>'), 'test_sender', "Resend's shared test sender is refused");
report.is(senderProblem('onboarding@RESEND.dev'), 'test_sender', 'case does not hide it');
report.is(senderProblem('Brokers <noreply>'), 'malformed_sender', 'an address with no domain is refused');

report.section('every template has a declared category');

const declared = new Set(Object.keys(TEMPLATES));
const undeclared = [...new Set(sent)].filter((name) => !declared.has(name));
report.is(undeclared.join(', ') || 'none', 'none', 'every template notify.ts sends is in the registry');
const stale = [...declared].filter((name) => !sent.includes(name));
report.is(stale.join(', ') || 'none', 'none', 'no registry entry outlives its template');
report.is(TEMPLATES.password_changed, 'security', 'a password notice is a security message');
report.is(TEMPLATES.saved_search_digest, 'preference', 'a digest is a preference stream');

report.section('delivery events: replays, order, and whose mail it was');

async function sentRow(key, to, providerId, template = 'application_receipt', essential = false) {
  const { rows } = await db.query(
    'select public.claim_email($1, $2, $3, null, null, null, $4) as id',
    [key, template, to, essential],
  );
  await db.query(`select public.record_email_attempt($1, 'sent', $2, null, false)`, [rows[0].id, providerId]);
  return rows[0].id;
}
async function event(id, providerId, kind) {
  const { rows } = await db.query('select public.record_email_event($1, $2, $3) as r', [id, providerId, kind]);
  return rows[0].r;
}
async function statusOf(id) {
  const { rows } = await db.query('select status, attempts from email_log where id = $1', [id]);
  return rows[0];
}
async function suppressedAs(address) {
  const { rows } = await db.query('select reason from email_suppressions where email = $1', [address]);
  return rows[0]?.reason ?? null;
}

const r1 = await sentRow('ev:1', 'ev1@brokersconnect.net', 'pv-1');
const firstEvent = await event('evt_1', 'pv-1', 'delivered');
report.is(firstEvent.matched, 1, 'an event about our message matches it');
const replay = await event('evt_1', 'pv-1', 'delivered');
report.is(replay.duplicate, true, 'the same event id a second time is recognised as a replay');
report.is((await statusOf(r1)).status, 'delivered', 'and delivered stands');

await event('evt_2', 'pv-1', 'delayed');
report.is((await statusOf(r1)).status, 'delivered', 'a late delivery_delayed cannot turn delivered back into sent');

await event('evt_3', 'pv-1', 'complained');
report.is((await statusOf(r1)).status, 'complained', 'a complaint after delivery is recorded');
await event('evt_4', 'pv-1', 'delivered');
report.is((await statusOf(r1)).status, 'complained', 'and a late delivery cannot overwrite the complaint');
report.is(await suppressedAs('ev1@brokersconnect.net'), 'complaint', 'the complainer is suppressed');

const foreign = await event('evt_5', 'someone-elses-message', 'complained');
report.is(foreign.matched, 0, "an event about another site's mail on the shared account matches nothing");
const { rows: foreignSup } = await db.query('select count(*)::int as n from email_suppressions where reason = $1', ['complaint']);
report.is(foreignSup[0].n, 1, 'and suppresses nobody');

const r2 = await sentRow('ev:2', 'Hard@BrokersConnect.net', 'pv-2');
await event('evt_6', 'pv-2', 'bounced_hard');
report.is((await statusOf(r2)).status, 'bounced', 'a hard bounce marks the message bounced');
report.is(await suppressedAs('hard@brokersconnect.net'), 'hard_bounce', 'and suppresses the recorded recipient, lower-cased');

const r3 = await sentRow('ev:3', 'gone@brokersconnect.net', 'pv-3');
await event('evt_7', 'pv-3', 'failed');
const failedRow = await statusOf(r3);
report.is(failedRow.status, 'failed', 'a provider failure after acceptance is recorded');
report.ok(failedRow.attempts >= 3, 'and is never picked up by the sweeper to be sent twice');

const r4 = await sentRow('ev:4', 'listed@brokersconnect.net', 'pv-4');
await event('evt_8', 'pv-4', 'suppressed');
report.is((await statusOf(r4)).status, 'suppressed', "the provider's own suppression is recorded");
report.is(await suppressedAs('listed@brokersconnect.net'), 'provider', 'and mirrored locally');

report.section('repeated soft bounces');

for (let i = 1; i <= 2; i += 1) {
  await sentRow(`soft:${i}`, 'full@brokersconnect.net', `ps-${i}`);
  await event(`evt_soft_${i}`, `ps-${i}`, 'bounced_soft');
}
report.is(await suppressedAs('full@brokersconnect.net'), null, 'two soft bounces do not suppress — a full inbox recovers');
await sentRow('soft:3', 'full@brokersconnect.net', 'ps-3');
await event('evt_soft_3', 'ps-3', 'bounced_soft');
report.is(await suppressedAs('full@brokersconnect.net'), 'repeated_soft_bounce', 'the third in thirty days does');
await event('evt_soft_3', 'ps-3', 'bounced_soft');
const { rows: softCount } = await db.query(
  `select count(*)::int as n from email_webhook_events where kind = 'bounced_soft' and recipient = 'full@brokersconnect.net'`,
);
report.is(softCount[0].n, 3, 'a replayed soft bounce is not counted twice');

report.section('security notices get through a complaint, nothing gets through a dead address');

async function claimAs(key, to, template, essential) {
  const { rows } = await db.query(
    'select public.claim_email($1, $2, $3, null, null, null, $4) as id',
    [key, template, to, essential],
  );
  return rows[0].id;
}
report.is(await claimAs('c:1', 'ev1@brokersconnect.net', 'saved_search_digest', false), null,
  'a complainer gets no digest');
report.is(await claimAs('c:2', 'ev1@brokersconnect.net', 'application_receipt', false), null,
  'and no ordinary transactional mail');
report.ok(await claimAs('c:3', 'ev1@brokersconnect.net', 'password_changed', true),
  'but is still told their password changed');
report.is(await claimAs('c:4', 'hard@brokersconnect.net', 'password_changed', true), null,
  'a hard-bounced address gets nothing, security included');

report.section('one inbox cannot be flooded');

for (let i = 0; i < 30; i += 1) {
  await claimAs(`flood:${i}`, 'target@brokersconnect.net', 'new_application', false);
}
report.is(await claimAs('flood:30', 'target@brokersconnect.net', 'new_application', false), null,
  'the thirty-first message in an hour to one address is refused');
const { rows: flood } = await db.query(`select status, error from email_log where dedupe_key = 'flood:30'`);
report.is(flood[0]?.status, 'suppressed', 'and the refusal is on the record');
report.ok(await claimAs('flood:sec', 'target@brokersconnect.net', 'password_changed', true),
  'a security notice still reaches that inbox');

report.section('rate limits for actions that leave no row');

const hits = [];
for (let i = 0; i < 4; i += 1) {
  const { rows } = await db.query(`select public.hit_rate_limit('reset:email:abc', 3, 3600) as ok`);
  hits.push(rows[0].ok);
}
report.is(hits.join(','), 'true,true,true,false', 'three allowed, the fourth refused');
const { rows: otherBucket } = await db.query(`select public.hit_rate_limit('reset:email:xyz', 3, 3600) as ok`);
report.is(otherBucket[0].ok, true, 'buckets are independent');
await db.query(`update rate_limit_hits set created_at = now() - interval '2 hours' where bucket = 'reset:email:abc'`);
const { rows: expired } = await db.query(`select public.hit_rate_limit('reset:email:abc', 3, 3600) as ok`);
report.is(expired[0].ok, true, 'the window slides — an hour later it is allowed again');

// ---------------------------------------------------------------------------
// Every link in every template points at a page that exists
// ---------------------------------------------------------------------------

report.section('every button in every template opens a page that exists');
{
  /*
    A renamed route would not break a build — the href is a string — and would
    not break a test that renders the mail. It would break the mail, for every
    reader, until somebody clicked one. So each `${env.siteUrl}/…` in the
    email code is resolved against src/app the way Next does: route groups in
    parentheses are transparent, `[param]` matches any segment, and the leaf
    must hold a page.tsx or route.ts.
  */
  const { readdirSync, existsSync, statSync } = await import('node:fs');
  const APP = join(ROOT, 'src/app');

  const resolves = (path) => {
    const segments = path.split('?')[0].split('#')[0].split('/').filter(Boolean);
    const walk = (dir, i) => {
      if (i === segments.length) {
        return existsSync(join(dir, 'page.tsx')) || existsSync(join(dir, 'route.ts')) ||
          readdirSync(dir).some((e) => e.startsWith('(') && statSync(join(dir, e)).isDirectory() && walk(join(dir, e), i));
      }
      const wanted = segments[i];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (!statSync(full).isDirectory()) continue;
        if (entry.startsWith('(')) { if (walk(full, i)) return true; continue; }
        if (entry === wanted) { if (walk(full, i + 1)) return true; }
      }
      // Only if nothing static matched: a [param] directory takes any value,
      // so borrowing one for a static name is a guess. A catch-all is not a
      // page for arbitrary paths at all — it is where a wrong path ends up.
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (!statSync(full).isDirectory() || !entry.startsWith('[') || entry.startsWith('[...')) continue;
        if (walk(full, i + 1)) return true;
      }
      return false;
    };
    // Every page lives under app/[locale]; the api routes under app/api.
    // Pages live under app/[locale]; the api routes under app/api. Not app
    // itself: [locale] is a dynamic directory and would match any segment.
    return walk(join(APP, '[locale]'), 0) || walk(join(APP, 'api'), 0);
  };

  const sources = ['src/lib/email/notify.ts', 'src/lib/email/envelope.ts', 'src/lib/email/components.ts'];
  const seen = new Set();
  for (const file of sources) {
    const code = read(file);
    for (const m of code.matchAll(/\$\{env\.siteUrl\}([^`]*)/g)) {
      // A `${…}` that is a plain value is one segment of the path; one that is
      // a ternary (`${args.query ? … : ''}`) is where the path ends.
      const path = m[1]
        .replace(/\$\{([^}]*)\}/g, (_, expr) => (expr.includes('?') ? '\u0000' : 'x'))
        .split('\u0000')[0]
        .split('?')[0]
        .split('#')[0]
        .replace(/['"].*$/, '')
        // A nested template literal ends the match at its backtick and leaves an
        // unterminated `${`; whatever follows a bare `$` is not path.
        .split('$')[0]
        .replace(/\/$/, '');
      if (seen.has(path)) continue;
      seen.add(path);
      // A file with an extension is an asset served from public/, not a page.
      if (/\.[a-z0-9]+$/i.test(path)) {
        report.ok(existsSync(join(ROOT, 'public', path)), `${path} (from ${file.split('/').pop()}) exists in public/`);
        continue;
      }
      report.ok(resolves(path), `${path} (from ${file.split('/').pop()}) is a real page`);
    }
  }
  report.ok(seen.size >= 10, `found ${seen.size} distinct link targets to check`);
}

await db.close?.();
process.exitCode = report.finish() ? 0 : 1;
