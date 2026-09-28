/**
 * Sending pushes, against a stand-in Expo and a stand-in database.
 *
 *   node --experimental-strip-types scripts/push-sweep.test.mjs
 *
 * What is pinned: what a phone is sent (the bell's sentence, in the phone's
 * language, never the note; the unread count as the badge; only the
 * notification's id to open it by); how each leased row ends — sent, skipped,
 * retried or failed — for every way Expo can answer; a hundred messages to a
 * request without splitting one person's phones; phones Expo says are gone,
 * switched off whether it says so at once or in a receipt; and the Expo client
 * itself.
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { createTranslator } = await import('next-intl');
const { sweepPushes, checkReceipts } = await import('../src/lib/push/sweep.ts');
const { composePush } = await import('../src/lib/push/compose.ts');
const { sendToExpo, ExpoRefused, ExpoUnavailable } = await import('../src/lib/push/expo.ts');

const messages = {
  ar: JSON.parse(readFileSync(new URL('../messages/ar.json', import.meta.url), 'utf8')),
  en: JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8')),
};
const translators = Object.fromEntries(
  ['ar', 'en'].map((locale) => {
    const t = createTranslator({ locale, messages: messages[locale], onError: () => {} });
    return [locale, (key, values) => t(key, values)];
  }),
);

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

const NOTE = 'ملاحظة خاصة: السبب إن السيرة الذاتية ناقصة';
const moved = (id, user, extra = {}) => ({
  id,
  user_id: user,
  kind: 'application_moved',
  payload: { title_ar: 'مستشار مبيعات', title_en: 'Sales consultant', status: 'shortlisted', note: NOTE },
  read_at: null,
  ...extra,
});
const phone = (id, locale = 'ar', platform = 'ios') => ({
  id,
  token: `ExponentPushToken[${id.padEnd(22, 'x')}]`,
  locale,
  platform,
});

/** A stand-in database and Expo, recording everything asked of them. */
function world({ rows, notifications, devices, unread = {}, send, settleThrows = null }) {
  const queue = [...rows];
  const settled = [];
  const kept = [];
  const disabled = [];
  const sent = [];
  const deps = {
    lease: async (limit) => queue.splice(0, limit),
    settle: async (id, token, outcome, detail) => {
      if (settleThrows === id) throw new Error('database went away');
      settled.push({ id, token, outcome, detail });
      return true;
    },
    load: async () => ({
      notifications: new Map(notifications.map((n) => [n.id, n])),
      devices: new Map(Object.entries(devices)),
      unread: new Map(Object.entries(unread)),
    }),
    send: async (batch) => {
      sent.push(batch);
      return send(batch);
    },
    keepTickets: async (tickets) => kept.push(...tickets),
    disableDevices: async (ids, reason) => disabled.push(...ids.map((id) => ({ id, reason }))),
    translator: (locale) => translators[locale],
    deadline: { expired: () => false, remainingMs: () => 10_000 },
  };
  return { deps, settled, kept, disabled, sent };
}

const lease = (id, notification, user) => ({ id, notification_id: notification, user_id: user, attempts: 0, lock_token: `token-${id}` });
const allOk = (batch) => batch.map((_, index) => ({ status: 'ok', id: `ticket-${index}` }));

console.log('— what a phone is sent');
{
  const w = world({
    rows: [lease(1, 'n1', 'u1')],
    notifications: [moved('n1', 'u1')],
    devices: { u1: [phone('arabic', 'ar'), phone('english', 'en', 'android')] },
    unread: { u1: 3 },
    send: allOk,
  });
  const stats = await sweepPushes(w.deps);
  const [arabic, english] = w.sent[0];
  ok('one message per phone', w.sent.length === 1 && w.sent[0].length === 2);
  ok('the bell\'s sentence, in each phone\'s language',
    arabic.body.includes('مستشار مبيعات') && english.body.includes('Sales consultant') && english.body.includes(messages.en.applicationStatus.shortlisted),
    `${arabic.body} | ${english.body}`);
  ok('never the note', !arabic.body.includes(NOTE) && !english.body.includes(NOTE) && !JSON.stringify(w.sent).includes(NOTE));
  ok('the unread count as the badge', arabic.badge === 3 && english.badge === 3);
  ok('only the notification\'s id to open it by', JSON.stringify(arabic.data) === JSON.stringify({ notificationId: 'n1' }));
  ok('a sound, and a day\'s grace at most', arabic.sound === 'default' && arabic.ttl <= 24 * 3600);
  ok('an Android phone on its channel, an iPhone without one', english.channelId === 'default' && arabic.channelId === undefined);
  ok('settled as sent, with each ticket kept against its phone',
    w.settled[0].outcome === 'sent' && w.settled[0].token === 'token-1' &&
      w.kept.map((k) => k.device_id).join() === 'arabic,english' && w.kept.every((k) => k.outbox_id === 1));
  ok('and counted', stats.sent === 1 && stats.messages === 2 && stats.leased === 1);
}

console.log('\n— nothing to send any more');
{
  const w = world({
    rows: [lease(1, 'read', 'u1'), lease(2, 'gone', 'u1'), lease(3, 'n3', 'nobody')],
    notifications: [moved('read', 'u1', { read_at: '2026-10-01T10:00:00Z' }), moved('n3', 'nobody')],
    devices: { u1: [phone('p1')] },
    send: allOk,
  });
  await sweepPushes(w.deps);
  const byId = Object.fromEntries(w.settled.map((s) => [s.id, s]));
  ok('read already: skipped', byId[1].outcome === 'skipped' && byId[1].detail === 'read already');
  ok('the notification gone: skipped', byId[2].outcome === 'skipped' && byId[2].detail === 'notification gone');
  ok('no phone left: skipped', byId[3].outcome === 'skipped' && byId[3].detail === 'no phone');
  ok('and nothing was sent for any of them', w.sent.length === 0);
}

console.log('\n— when Expo does not take it');
{
  const down = world({
    rows: [lease(1, 'n1', 'u1'), lease(2, 'n2', 'u2')],
    notifications: [moved('n1', 'u1'), moved('n2', 'u2')],
    devices: { u1: [phone('a')], u2: [phone('b')] },
    send: async () => { throw new ExpoUnavailable('HTTP 503'); },
  });
  await sweepPushes(down.deps);
  ok('Expo down: every row in the request backs off', down.settled.every((s) => s.outcome === 'retry' && s.detail === 'HTTP 503') && down.settled.length === 2);

  const refused = world({
    rows: [lease(1, 'n1', 'u1')],
    notifications: [moved('n1', 'u1')],
    devices: { u1: [phone('a')] },
    send: async () => { throw new ExpoRefused('HTTP 401 UNAUTHORIZED'); },
  });
  await sweepPushes(refused.deps);
  ok('Expo refusing the request itself: failed, not retried', refused.settled[0].outcome === 'failed');

  const oneGone = world({
    rows: [lease(1, 'n1', 'u1')],
    notifications: [moved('n1', 'u1')],
    devices: { u1: [phone('gone'), phone('here')] },
    send: async () => [
      { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
      { status: 'ok', id: 'ticket-here' },
    ],
  });
  await sweepPushes(oneGone.deps);
  ok('one phone of two gone: still sent, to the other', oneGone.settled[0].outcome === 'sent');
  ok('the gone phone switched off at once', oneGone.disabled.length === 1 && oneGone.disabled[0].id === 'gone' && oneGone.disabled[0].reason === 'DeviceNotRegistered');
  ok('only the delivered ticket kept', oneGone.kept.length === 1 && oneGone.kept[0].ticket_id === 'ticket-here');

  const allGone = world({
    rows: [lease(1, 'n1', 'u1')],
    notifications: [moved('n1', 'u1')],
    devices: { u1: [phone('gone')] },
    send: async () => [{ status: 'error', details: { error: 'DeviceNotRegistered' } }],
  });
  await sweepPushes(allGone.deps);
  ok('every phone gone: skipped, and the phones switched off', allGone.settled[0].outcome === 'skipped' && allGone.disabled.length === 1);

  const busy = world({
    rows: [lease(1, 'n1', 'u1')],
    notifications: [moved('n1', 'u1')],
    devices: { u1: [phone('a')] },
    send: async () => [{ status: 'error', details: { error: 'MessageRateExceeded' } }],
  });
  await sweepPushes(busy.deps);
  ok('too many messages to one phone: tried again later', busy.settled[0].outcome === 'retry' && busy.disabled.length === 0);

  const tooBig = world({
    rows: [lease(1, 'n1', 'u1')],
    notifications: [moved('n1', 'u1')],
    devices: { u1: [phone('a')] },
    send: async () => [{ status: 'error', details: { error: 'MessageTooBig' } }],
  });
  await sweepPushes(tooBig.deps);
  ok('a message Expo will never take: failed', tooBig.settled[0].outcome === 'failed' && tooBig.settled[0].detail === 'MessageTooBig');
}

console.log('\n— a hundred to a request, one person never split');
{
  const users = Array.from({ length: 3 }, (_, i) => `u${i}`);
  const devices = Object.fromEntries(users.map((user) => [user, Array.from({ length: 40 }, (_, i) => phone(`${user}-${i}`))]));
  const w = world({
    rows: users.map((user, i) => lease(i + 1, `n${i}`, user)),
    notifications: users.map((user, i) => moved(`n${i}`, user)),
    devices,
    send: allOk,
  });
  await sweepPushes(w.deps);
  ok('120 messages go as 80 and 40', w.sent.map((batch) => batch.length).join() === '80,40', w.sent.map((b) => b.length).join());
  ok('and every row is sent', w.settled.length === 3 && w.settled.every((s) => s.outcome === 'sent'));
}

console.log('\n— one bad settle does not strand the rest');
{
  const w = world({
    rows: [lease(1, 'n1', 'u1'), lease(2, 'n2', 'u2')],
    notifications: [moved('n1', 'u1'), moved('n2', 'u2')],
    devices: { u1: [phone('a')], u2: [phone('b')] },
    send: allOk,
    settleThrows: 1,
  });
  let thrown = null;
  try {
    await sweepPushes(w.deps);
  } catch (error) {
    thrown = error;
  }
  ok('the other row is still settled', w.settled.length === 1 && w.settled[0].id === 2);
  ok('and the run still says it failed', thrown?.message === 'database went away');
}

console.log('\n— receipts');
{
  const forgotten = [];
  const disabled = [];
  const stats = await checkReceipts({
    dueTickets: async () => [
      { ticket_id: 't-ok', device_id: 'd1' },
      { ticket_id: 't-gone', device_id: 'd2' },
      { ticket_id: 't-later', device_id: 'd3' },
    ],
    receipts: async () => ({
      't-ok': { status: 'ok' },
      't-gone': { status: 'error', details: { error: 'DeviceNotRegistered' } },
    }),
    forget: async (ids) => forgotten.push(...ids),
    disableDevices: async (ids) => disabled.push(...ids),
  });
  ok('a phone Apple says has no app any more is switched off', disabled.join() === 'd2');
  ok('answered tickets are forgotten; one without a receipt yet is asked about again', forgotten.join() === 't-ok,t-gone');
  ok('and counted', stats.checked === 3 && stats.answered === 2 && stats.phonesOff === 1);
}

console.log('\n— the Expo client');
{
  const answering = (status, body) => async (url, init) => {
    answering.last = { url, init };
    return new Response(JSON.stringify(body), { status });
  };
  const message = composePush(moved('n1', 'u1'), phone('a'), 1, translators.ar);

  const tickets = await sendToExpo([message], { accessToken: 'expo-token', fetchImpl: answering(200, { data: [{ status: 'ok', id: 'x' }] }) });
  ok('a ticket per message', tickets.length === 1 && tickets[0].id === 'x');
  ok('the access token rides along when set', answering.last.init.headers.authorization === 'Bearer expo-token');
  ok('to Expo\'s send endpoint', answering.last.url === 'https://exp.host/--/api/v2/push/send');

  const kinds = [];
  for (const [label, status, body] of [
    ['503', 503, {}],
    ['429', 429, {}],
    ['a short answer', 200, { data: [] }],
  ]) {
    try {
      await sendToExpo([message], { fetchImpl: answering(status, body) });
      kinds.push(`${label}:none`);
    } catch (error) {
      kinds.push(`${label}:${error.name}`);
    }
  }
  ok('down, rate-limited or garbled is "try again"', kinds.every((kind) => kind.endsWith('ExpoUnavailable')), kinds.join(' '));

  let refusedName = null;
  try {
    await sendToExpo([message], { fetchImpl: answering(401, { errors: [{ code: 'UNAUTHORIZED' }] }) });
  } catch (error) {
    refusedName = error.name;
  }
  ok('a refused request is not retried', refusedName === 'ExpoRefused');

  let networkName = null;
  try {
    await sendToExpo([message], { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  } catch (error) {
    networkName = error.name;
  }
  ok('no network is "try again"', networkName === 'ExpoUnavailable');

  let tooMany = null;
  try {
    await sendToExpo(Array.from({ length: 101 }, () => message), { fetchImpl: answering(200, {}) });
  } catch (error) {
    tooMany = error.name;
  }
  ok('more than a hundred in one request is refused before sending', tooMany === 'ExpoRefused');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
