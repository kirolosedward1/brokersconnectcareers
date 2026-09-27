/**
 * One channel failing must not take another with it.
 *
 *   node --experimental-strip-types scripts/notification-dispatch.test.mjs
 *
 * publish() runs the in-app write and then each email for an event. The brief
 * this pins: an email failure does not erase the in-app notification, a bell
 * failure does not stop the email, one email throwing does not stop the next,
 * and none of it ever throws back into the request that published the event.
 */
const { dispatch } = await import('../src/lib/notifications/dispatch.ts');

let pass = 0;
let fail = 0;
function is(label, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const quiet = () => {};
const event = { type: 'APPLICATION_CREATED', applicationId: 'a' };

console.log('\n— the email provider is down');
{
  const bell = [];
  const report = await dispatch(
    {
      inApp: async () => void bell.push('written'),
      email: [async () => { throw new Error('502 from provider'); }],
    },
    event,
    quiet,
  );
  is('the in-app notification is still written', bell, ['written']);
  is('and reported as such', report.inApp, 'written');
  is('the email is reported failed, not thrown', report.email, ['failed']);
}

console.log('\n— the bell write fails');
{
  const sent = [];
  const report = await dispatch(
    {
      inApp: async () => { throw new Error('db down'); },
      email: [async () => (sent.push('employer'), 'sent')],
    },
    event,
    quiet,
  );
  is('the email still goes', sent, ['employer']);
  is('and the report says which half failed', report, { inApp: 'failed', email: ['sent'] });
}

console.log('\n— one of two emails throws');
{
  const sent = [];
  const report = await dispatch(
    {
      inApp: 'trigger:on_application_created',
      email: [
        async () => { throw new Error('boom'); },
        async () => (sent.push('receipt'), 'sent'),
      ],
    },
    event,
    quiet,
  );
  is('the second still sends', sent, ['receipt']);
  is('in-app written by the database is reported as such', report, { inApp: 'database', email: ['failed', 'sent'] });
}

console.log('\n— failures are logged, not swallowed silently');
{
  const lines = [];
  await dispatch(
    { inApp: 'none', email: [async () => { throw new Error('timeout'); }] },
    event,
    (line) => lines.push(line),
  );
  is('a warning names the event and the cause', lines.length === 1 && /APPLICATION_CREATED.*timeout/.test(lines[0]), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
