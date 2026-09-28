/**
 * The mobile API's doors, checked over HTTP against a running build.
 *
 *   BASE_URL=http://localhost:3000 pnpm smoke:mobile-api
 *
 * Everything here is answered before any database is asked, so it passes
 * against a local `next start` with no Supabase at all, and against production
 * without touching anybody's data. It proves what the unit test cannot: that
 * the routes are wired, that a signed-out call to a protected action is
 * refused, that a browser's cookie is never taken for a session, that an
 * unknown action and a wrong content type are refused, and that an auth
 * server that does not answer is a 503 — not a 401 that would sign the app out.
 *
 * AUTH_DOWN=1 adds that last check, for a build whose Supabase URL points at
 * nothing (it would fail, correctly, against a real one).
 */
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

let pass = 0;
let fail = 0;

function check(label, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path, { method = 'POST', headers = {}, body } = {}) {
  const response = await fetch(`${BASE}${path}`, { method, headers, body, redirect: 'manual' });
  let json = null;
  try {
    json = await response.clone().json();
  } catch {}
  return { status: response.status, headers: response.headers, json };
}

const json = { 'content-type': 'application/json' };
const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAifQ.c2ln';

console.log(`against ${BASE}\n`);

console.log('— a protected action needs a token');
{
  const r = await call('/api/mobile/v1/actions/deleteMyAccount', { headers: json, body: '{}' });
  check('401 without one', r.status === 401, `got ${r.status}`);
  check('says Bearer', r.headers.get('www-authenticate') === 'Bearer', r.headers.get('www-authenticate'));
  check('and is not cached', (r.headers.get('cache-control') ?? '').includes('no-store'));
}

console.log('\n— a browser cookie is never a session here');
{
  const cookie = 'sb-hiwdhicwsohbipxzazmb-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0';
  const r = await call('/api/mobile/v1/actions/deleteMyAccount', { headers: { ...json, cookie }, body: '{}' });
  check('still 401 with only a cookie', r.status === 401, `got ${r.status}`);
  const form = await call('/api/mobile/v1/actions/deleteMyAccount', {
    headers: { 'content-type': 'text/plain', cookie },
    body: 'x',
  });
  check('a cross-site text/plain post with a cookie is refused', form.status === 401, `got ${form.status}`);
}

console.log('\n— malformed credentials are refused without a round trip');
{
  const r = await call('/api/mobile/v1/actions/deleteMyAccount', {
    headers: { ...json, authorization: 'Bearer sb_publishable_not_a_jwt' },
    body: '{}',
  });
  check('401', r.status === 401, `got ${r.status}`);
  check('invalid_token', (r.headers.get('www-authenticate') ?? '').includes('invalid_token'));
}

console.log('\n— only listed actions exist');
{
  const r = await call('/api/mobile/v1/actions/moderateJob', { headers: json, body: '{}' });
  check('an admin action is not one (404)', r.status === 404, `got ${r.status}`);
  const p = await call('/api/mobile/v1/actions/__proto__', { headers: json, body: '{}' });
  check('nor is a prototype key (404)', p.status === 404, `got ${p.status}`);
  const g = await call('/api/mobile/v1/actions/reportAuthOutcome', { method: 'GET' });
  check('GET is not a way in (405)', g.status === 405, `got ${g.status}`);
}

console.log('\n— a signed-out action runs, in JSON only');
{
  const plain = await call('/api/mobile/v1/actions/reportAuthOutcome', {
    headers: { 'content-type': 'text/plain' },
    body: '{"input":{}}',
  });
  check('text/plain is refused (415)', plain.status === 415, `got ${plain.status}`);
  const bad = await call('/api/mobile/v1/actions/reportAuthOutcome', { headers: json, body: '{not json' });
  check('broken JSON is refused (400)', bad.status === 400, `got ${bad.status}`);
  const big = await call('/api/mobile/v1/actions/reportAuthOutcome', {
    headers: json,
    body: JSON.stringify({ input: { email: 'x'.repeat(300 * 1024) } }),
  });
  check('an oversized body is refused (413)', big.status === 413, `got ${big.status}`);
  const r = await call('/api/mobile/v1/actions/reportAuthOutcome', {
    headers: json,
    body: JSON.stringify({ input: { kind: 'sign_in_failed' } }),
  });
  check('runs, and answers 200', r.status === 200, `got ${r.status}`);
  check(
    'with the action\'s own answer',
    r.json && typeof r.json.pause === 'number' && typeof r.json.challenge === 'boolean',
    JSON.stringify(r.json),
  );
}

console.log('\n— config is public and says nothing secret');
{
  const r = await call('/api/mobile/v1/config', { method: 'GET' });
  check('200', r.status === 200, `got ${r.status}`);
  check('has a minimum version', typeof r.json?.minAppVersion === 'string');
  check('names the providers', typeof r.json?.providers?.google === 'boolean' && typeof r.json?.providers?.apple === 'boolean');
  check('carries no key', !JSON.stringify(r.json ?? {}).match(/service|secret|sb_secret/i));
}

console.log('\n— the directory needs a token');
{
  const r = await call('/api/mobile/v1/agents', { method: 'GET' });
  check('401 signed out', r.status === 401, `got ${r.status}`);
}

console.log('\n— the shared CV route keeps its website behaviour');
{
  const r = await call('/api/cv/00000000-0000-0000-0000-000000000000', { method: 'GET' });
  check('401 with no session at all', r.status === 401, `got ${r.status}`);
  const m = await call('/api/cv/00000000-0000-0000-0000-000000000000', {
    method: 'GET',
    headers: { authorization: 'Token abc' },
  });
  check('a malformed bearer is 401 invalid_token', m.status === 401 && (m.headers.get('www-authenticate') ?? '').includes('invalid_token'), `got ${m.status}`);
}

if (process.env.AUTH_DOWN === '1') {
  console.log('\n— an auth server that does not answer is an outage, not a sign-out');
  const r = await call('/api/mobile/v1/actions/deleteMyAccount', {
    headers: { ...json, authorization: `Bearer ${fakeJwt}` },
    body: '{}',
  });
  check('503, not 401', r.status === 503, `got ${r.status}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
