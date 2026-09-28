/**
 * Revoking a Sign in with Apple grant, against a stand-in Apple.
 *
 *   node --experimental-strip-types scripts/apple-revoke.test.mjs
 *
 * The client secret is a real ES256 JWT, signed with a key made here and
 * verified with its public half, so a signature in the wrong encoding (DER
 * instead of the r‖s JWS wants) fails. The exchange-then-revoke is driven by
 * a fake fetch that answers the way Apple does, including its refusals.
 */
import { generateKeyPairSync, verify } from 'node:crypto';

const { appleConfigFromEnv, clientSecret, revokeWithAuthorizationCode } = await import('../src/lib/apple/revoke.ts');

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

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const config = { teamId: 'ABCDE12345', keyId: 'KEY1234567', privateKey: pem, clientId: 'net.brokersconnect.app' };

console.log('— the settings');
is('all four set', appleConfigFromEnv({ APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY: 'P', APPLE_CLIENT_ID: 'C' })?.clientId, 'C');
is('a key with escaped newlines is unescaped', appleConfigFromEnv({ APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY: 'a\\nb', APPLE_CLIENT_ID: 'C' })?.privateKey, 'a\nb');
is('one missing is none', appleConfigFromEnv({ APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_CLIENT_ID: 'C' }), null);
is('a placeholder is none', appleConfigFromEnv({ APPLE_TEAM_ID: 'REPLACE_ME', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY: 'P', APPLE_CLIENT_ID: 'C' }), null);

console.log('\n— the client secret');
const secret = clientSecret(config, 1_800_000_000);
const [head, body, signature] = secret.split('.');
const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString());
is('ES256, with the key id', decode(head), { alg: 'ES256', kid: 'KEY1234567' });
is('from the team, for the app, to Apple, for five minutes', decode(body), {
  iss: 'ABCDE12345',
  iat: 1_800_000_000,
  exp: 1_800_000_300,
  aud: 'https://appleid.apple.com',
  sub: 'net.brokersconnect.app',
});
is('signed r‖s, 64 bytes', Buffer.from(signature, 'base64url').length, 64);
is(
  'and the signature verifies with the public key',
  verify('sha256', Buffer.from(`${head}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')),
  true,
);

/** A stand-in Apple: answers each endpoint from the script given, and remembers what it was sent. */
function fakeApple(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, form: Object.fromEntries(new URLSearchParams(init.body)) });
    const answer = answers[path];
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer?.body ?? {}), { status: answer?.status ?? 200 });
  };
  return { calls, fetchImpl };
}

console.log('\n— revoking');
{
  const apple = fakeApple({ '/auth/token': { body: { refresh_token: 'r-token', access_token: 'a-token' } }, '/auth/revoke': { status: 200 } });
  is('a good code is exchanged and the grant revoked', await revokeWithAuthorizationCode('code-1234567', config, apple.fetchImpl), 'revoked');
  is('the exchange names the app and the code', [apple.calls[0].path, apple.calls[0].form.client_id, apple.calls[0].form.code, apple.calls[0].form.grant_type], [
    '/auth/token',
    'net.brokersconnect.app',
    'code-1234567',
    'authorization_code',
  ]);
  is('the refresh token is what is revoked', [apple.calls[1].path, apple.calls[1].form.token, apple.calls[1].form.token_type_hint], [
    '/auth/revoke',
    'r-token',
    'refresh_token',
  ]);
  is('with a signed secret each time', apple.calls.every((call) => call.form.client_secret.split('.').length === 3), true);
}
{
  const apple = fakeApple({ '/auth/token': { status: 400, body: { error: 'invalid_grant' } } });
  is("a code Apple refuses asks for another", await revokeWithAuthorizationCode('expired-code', config, apple.fetchImpl), 'invalid_code');
  is('and nothing is revoked', apple.calls.length, 1);
}
{
  const apple = fakeApple({ '/auth/token': { status: 503 } });
  is('Apple down is unavailable, not a refusal', await revokeWithAuthorizationCode('code-1234567', config, apple.fetchImpl), 'unavailable');
}
{
  const apple = fakeApple({ '/auth/token': new TypeError('fetch failed') });
  is('a network failure is unavailable', await revokeWithAuthorizationCode('code-1234567', config, apple.fetchImpl), 'unavailable');
}
{
  const apple = fakeApple({ '/auth/token': { body: { access_token: 'a-token' } }, '/auth/revoke': { status: 200 } });
  is('without a refresh token the access token is revoked', await revokeWithAuthorizationCode('code-1234567', config, apple.fetchImpl), 'revoked');
  is('named as such', apple.calls[1].form.token_type_hint, 'access_token');
}
is('without the settings nothing is attempted', await revokeWithAuthorizationCode('code-1234567', null), 'not_configured');
is('a key that does not parse is unavailable', await revokeWithAuthorizationCode('code-1234567', { ...config, privateKey: 'not a key' }, fakeApple({}).fetchImpl), 'unavailable');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
