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
  check('says where to write, or that nowhere is set', r.json?.supportEmail === null || typeof r.json?.supportEmail === 'string');
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

console.log('\n— an email link: a GET draws a button and spends nothing');
{
  const hash = 'a'.repeat(56);
  const onboarding = '/onboarding?role=employer&confirmed=1';
  const redirect = `${BASE}/auth/callback?next=${encodeURIComponent(onboarding)}`;
  const r = await fetch(`${BASE}/auth/confirm?token_hash=${hash}&type=email&redirect_to=${redirect}`, { redirect: 'manual' });
  const html = await r.text();
  check('200, a page with one form', r.status === 200 && html.includes('<form method="post" action="/auth/confirm">'), `got ${r.status}`);
  check('carrying the token and the destination, unwrapped', html.includes(`value="${hash}"`) && html.includes('value="/onboarding?role=employer&amp;confirmed=1"'));
  check('never cached, indexed or referred', (r.headers.get('cache-control') ?? '').includes('no-store') && (r.headers.get('x-robots-tag') ?? '').includes('noindex') && html.includes('<meta name="referrer" content="no-referrer">'));
  const bad = await fetch(`${BASE}/auth/confirm?token_hash=x&type=email`, { redirect: 'manual' });
  check('a malformed link goes to sign-in, "expired"', bad.status === 303 && (bad.headers.get('location') ?? '').endsWith('/sign-in?error=link_expired'), `got ${bad.status} ${bad.headers.get('location')}`);
}

console.log('\n— and a POST spends it only from this site');
{
  const body = () => new URLSearchParams({ token_hash: 'a'.repeat(56), type: 'email', next: '' });
  const form = { 'content-type': 'application/x-www-form-urlencoded' };
  const cross = await fetch(`${BASE}/auth/confirm`, { method: 'POST', body: body(), headers: { ...form, origin: 'https://evil.example' }, redirect: 'manual' });
  check('another origin is 403', cross.status === 403, `got ${cross.status}`);
  const fetchSite = await fetch(`${BASE}/auth/confirm`, { method: 'POST', body: body(), headers: { ...form, 'sec-fetch-site': 'cross-site' }, redirect: 'manual' });
  check('a cross-site fetch is 403', fetchSite.status === 403, `got ${fetchSite.status}`);
  if (process.env.AUTH_DOWN === '1') {
    // Only where the auth server is nowhere: the token is made up.
    const same = await fetch(`${BASE}/auth/confirm`, { method: 'POST', body: body(), headers: { ...form, origin: BASE }, redirect: 'manual' });
    check('a token that does not verify goes to sign-in, "expired"', same.status === 303 && (same.headers.get('location') ?? '').endsWith('/sign-in?error=link_expired'), `got ${same.status} ${same.headers.get('location')}`);
  }
}

console.log('\n— the universal-link file');
{
  const r = await fetch(`${BASE}/.well-known/apple-app-site-association`, { redirect: 'manual' });
  if (process.env.APPLE_APP_ID) {
    const file = await r.json().catch(() => null);
    check('200 JSON, no redirect', r.status === 200 && (r.headers.get('content-type') ?? '').startsWith('application/json'), `got ${r.status}`);
    check('naming the app', file?.applinks?.details?.[0]?.appIDs?.includes(process.env.APPLE_APP_ID.split(',')[0].trim()));
  } else {
    check('no app configured, no file (404)', r.status === 404, `got ${r.status}`);
  }
}

console.log('\n— the captcha page');
{
  const r = await fetch(`${BASE}/api/mobile/v1/captcha?action=sign-up&theme=dark`, { redirect: 'manual' });
  if (r.status === 404) {
    check('no site key, no page', (await r.json().catch(() => null))?.error === 'captcha_disabled');
  } else {
    const html = await r.text();
    check('200, the widget for the WebView', r.status === 200 && html.includes('ReactNativeWebView') && html.includes('"action":"sign-up"') && html.includes('"theme":"dark"'), `got ${r.status}`);
    check('never cached', (r.headers.get('cache-control') ?? '').includes('no-store'));
  }
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
