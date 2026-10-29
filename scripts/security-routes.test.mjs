import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';

// Exercise the real route handlers, replacing only external auth/database I/O.
const state = globalThis.securityRouteTest = { user: { id: 'user' }, error: null, due: false, calls: 0 };
const mocks = {
  '@/lib/supabase/server': `export async function createClient() { return { auth: { getUser: async () => { const s=globalThis.securityRouteTest; if(s.throwAuth) throw Error('offline'); return {data:{user:s.user},error:s.error}; } } }; }`,
  '@/lib/auth/second-factor-server': `export async function sessionOwesSecondFactor() { const s=globalThis.securityRouteTest; if(s.throwMfa) throw Error('offline'); return s.due; }`,
  '@/lib/supabase/admin': `export function createAdminClient() { globalThis.securityRouteTest.calls++; throw Error('Unexpected database access'); }`,
  '@/lib/actions/attribution': `export async function saveFirstTouch() { globalThis.securityRouteTest.calls++; return {ok:true}; }`,
  '@/lib/observe': `export function logFailure() {}`,
  '@/lib/env': `export const env={siteUrl:'https://example.test'}; export const configuredValue=v=>v || undefined;`,
};
registerHooks({ resolve(specifier, context, next) {
  if (mocks[specifier]) return { url: 'data:text/javascript,' + encodeURIComponent(mocks[specifier]), shortCircuit: true };
  if (specifier === 'server-only') return { url: 'data:text/javascript,export {};', shortCircuit: true };
  if (specifier === 'next/server') return next('next/server.js', context);
  if (specifier.startsWith('@/')) return next(new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href, context);
  if (specifier.startsWith('.') && context.parentURL?.includes('/src/')) {
    const url = new URL(specifier, context.parentURL);
    if (!existsSync(url) && existsSync(new URL(url.href + '.ts'))) return next(url.href + '.ts', context);
  }
  return next(specifier, context);
}});
const { NextRequest } = await import('next/server');
const { withOptionalBearer } = await import('../src/lib/mobile-api/http.ts');
const { readRequestText } = await import('../src/lib/security/request-body.ts');
const routes = await Promise.all(['email/webhook', 'paymob/webhook', 'attribution', 'unsubscribe'].map(async path => ({
  path, limit: path.includes('webhook') ? 262144 : 8192,
  post: (await import(`../src/app/api/${path}/route.ts`)).POST,
})));
process.env.RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from('test-secret').toString('base64');
process.env.PAYMOB_HMAC_SECRET = 'test-secret';

function request(path, body, headers = {}) {
  return new NextRequest('https://example.test/api/' + path, { method: 'POST', body, duplex: 'half', headers: { origin: 'https://example.test', ...headers } });
}
for (const {path, limit, post} of routes) {
  test(`${path}: declared oversize is rejected before reading or database access`, async () => {
    let reads = 0;
    const body = new ReadableStream({pull(c) { reads++; c.enqueue(new Uint8Array(1)); }}, {highWaterMark:0});
    state.calls = 0;
    assert.equal((await post(request(path, body, {'content-length': String(limit+1)}))).status, 413);
    assert.equal(reads, 0);
    assert.equal(state.calls, 0);
  });
  test(`${path}: chunked and falsely small bodies stop at the byte limit`, async () => {
    for (const headers of [{}, {'content-length':'1'}]) {
      let reads = 0, cancelled = false;
      const body = new ReadableStream({pull(c) { reads++; c.enqueue(new Uint8Array(limit)); }, cancel() {cancelled=true;}}, {highWaterMark:0});
      state.calls = 0;
      assert.equal((await post(request(path, body, headers))).status, 413);
      assert.equal(reads, 2);
      assert.equal(cancelled, true);
      assert.equal(state.calls, 0);
    }
  });
}
test('body limit preserves exact text at the boundary and rejects interrupted streams', async () => {
  const text = ' { "message": "مرحبا" }\n';
  assert.deepEqual(await readRequestText(request('test', text), Buffer.byteLength(text)), {text});
  const body = new ReadableStream({pull(c) {c.error(Error('disconnected'));}});
  assert.equal((await readRequestText(request('test', body), 100)).refused.status, 400);
});
test('email webhook still verifies the original signed payload', async () => {
  const {createHmac} = await import('node:crypto');
  const raw = ' { "type": "unknown.event" }\n';
  const timestamp = String(Math.floor(Date.now()/1000));
  const signature = createHmac('sha256', 'test-secret').update(`event-test.${timestamp}.${raw}`).digest('base64');
  const route = routes[0];
  const response = await route.post(request(route.path, raw, {'svix-id':'event-test','svix-timestamp':timestamp,'svix-signature':`v1,${signature}`}));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ignored, true);
  assert.equal((await route.post(request(route.path, raw))).status, 401);
});
for (const [name, setup, expected] of [
  ['auth outage', {error:{status:503}}, 503],
  ['auth throws', {throwAuth:true}, 503],
  ['MFA check throws', {throwMfa:true}, 503],
  ['missing user', {user:null}, 401],
  ['MFA still required', {due:true}, 403],
  ['verified session', {}, 200],
]) {
  test(`private cookie route: ${name}`, async () => {
    Object.assign(state, {user:{id:'user'}, error:null, due:false, throwAuth:false, throwMfa:false}, setup);
    let handled = false;
    const route = withOptionalBearer(async () => {handled=true; return Response.json({ok:true});});
    const response = await route(new NextRequest('https://example.test/api/account/export'), {});
    assert.equal(response.status, expected);
    assert.equal(handled, expected===200);
    if(expected!==200) assert.equal(response.headers.get('cache-control'), 'no-store');
  });
}
test('unconfigured webhooks refuse without reading a body', async () => {
  for (const [path, key] of [['email/webhook','RESEND_WEBHOOK_SECRET'], ['paymob/webhook','PAYMOB_HMAC_SECRET']]) {
    const previous = process.env[key];
    delete process.env[key];
    try {
      let reads = 0;
      const body = new ReadableStream({pull(c) {reads++; c.enqueue(new Uint8Array(1));}}, {highWaterMark:0});
      assert.equal((await routes.find(r=>r.path===path).post(request(path, body))).status, 503);
      assert.equal(reads, 0);
    } finally { process.env[key] = previous; }
  }
});
test('small public requests retain their existing behavior', async () => {
  assert.equal((await routes.find(r=>r.path==='attribution').post(request('attribution', '{}'))).status, 200);
  const unsubscribe = await routes.find(r=>r.path==='unsubscribe').post(request('unsubscribe', 'List-Unsubscribe=One-Click'));
  assert.equal(unsubscribe.status, 400);
  const payment = routes.find(r=>r.path==='paymob/webhook');
  assert.equal((await payment.post(request(payment.path, '{'))).status, 400);
  assert.equal((await payment.post(request(payment.path, '{"obj":{}}'))).status, 401);
});
