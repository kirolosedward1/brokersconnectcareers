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

for (const table of ['email_log', 'email_suppressions']) {
  const { rows } = await db.query(
    `select relrowsecurity as on, (select count(*) from pg_policies where tablename = $1)::int as policies
       from pg_class where relname = $1`,
    [table],
  );
  report.ok(rows[0].on, `${table} has row-level security on`);
  report.is(rows[0].policies, 0, `${table} has no policies — deny-all, service role only`);
}

await db.close?.();
process.exitCode = report.finish() ? 0 : 1;
