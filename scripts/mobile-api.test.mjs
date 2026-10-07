/**
 * The mobile API's door rules that can be checked without a server.
 *
 *   node --experimental-strip-types scripts/mobile-api.test.mjs
 *
 * readBearer() decides whether a request carries something worth asking the
 * auth server about. The registry is checked by its source: which actions the
 * app may reach is a security property, and "the admin console is not one of
 * them" should fail a test the day somebody imports it, not show up in a
 * review. The HTTP behaviour (401s, 404s, 415s, no cookie fallback) is
 * exercised against a running build by scripts/mobile-api.smoke.mjs.
 */
import { readFileSync } from 'node:fs';

const { readBearer, challenge, tokenRefused } = await import('../src/lib/mobile-api/bearer.ts');
const { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError } = await import('@supabase/supabase-js');

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

const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';

console.log('— no header is a signed-out caller, not an error');
is('absent', readBearer(null), { kind: 'none' });
is('undefined', readBearer(undefined), { kind: 'none' });
is('empty', readBearer(''), { kind: 'none' });
is('whitespace', readBearer('   '), { kind: 'none' });

console.log('\n— a bearer JWT is a token to verify');
is('Bearer <jwt>', readBearer(`Bearer ${jwt}`), { kind: 'token', token: jwt });
is('scheme is case-insensitive', readBearer(`bearer ${jwt}`), { kind: 'token', token: jwt });
is('surrounding space is tolerated', readBearer(`  Bearer ${jwt}  `), { kind: 'token', token: jwt });
is('an unsigned JWT still has the shape', readBearer('Bearer aaa.bbb.'), { kind: 'token', token: 'aaa.bbb.' });

console.log('\n— anything else is refused without a round trip');
is('another scheme', readBearer(`Basic ${jwt}`), { kind: 'malformed' });
is('no scheme', readBearer(jwt), { kind: 'malformed' });
is('the publishable key by mistake', readBearer('Bearer sb_publishable_abc123'), { kind: 'malformed' });
is('a cron secret', readBearer('Bearer some-long-random-cron-secret'), { kind: 'malformed' });
is('two segments', readBearer('Bearer aaa.bbb'), { kind: 'malformed' });
is('four segments', readBearer('Bearer a.b.c.d'), { kind: 'malformed' });
is('a token with spaces', readBearer('Bearer aaa.bbb .ccc'), { kind: 'malformed' });
is('base64 padding is not base64url', readBearer('Bearer aa+a.bbb.ccc'), { kind: 'malformed' });
is('absurdly long', readBearer(`Bearer ${'a'.repeat(9000)}.b.c`), { kind: 'malformed' });

console.log('\n— the 401 says which kind');
is('no credentials', challenge('unauthenticated'), 'Bearer');
is('a refused token', challenge('invalid_token'), 'Bearer error="invalid_token"');

console.log('\n— a token check that failed: refused (the app refreshes, then signs out) or no answer (it keeps the session)');
is('no user and no error', tokenRefused(null), true);
is('a session ended elsewhere (403 session_not_found)', tokenRefused(new AuthSessionMissingError()), true);
is('a user who no longer exists (403 user_not_found)', tokenRefused(new AuthApiError('User not found', 403, 'user_not_found')), true);
is('a bad signature (401 bad_jwt)', tokenRefused(new AuthApiError('invalid JWT', 401, 'bad_jwt')), true);
is('the auth server unreachable', tokenRefused(new AuthRetryableFetchError('fetch failed', 0)), false);
is('the auth server failing (502)', tokenRefused(new AuthRetryableFetchError('Bad Gateway', 502)), false);
is('an answer that is not the auth server’s', tokenRefused(new AuthUnknownError('?', new Error('?'))), false);

console.log('\n— the app can reach only what the registry lists');
{
  const registry = readFileSync(new URL('../src/lib/mobile-api/registry.ts', import.meta.url), 'utf8');
  const imports = [...registry.matchAll(/from '(@\/lib\/actions\/[\w-]+)'/g)].map((match) => match[1]);
  is('found the action imports', imports.length > 10, true);
  is('never the admin console', imports.includes('@/lib/actions/admin'), false);
  is('never checkout', imports.includes('@/lib/actions/billing'), false);
  is(
    'never the admin client',
    /createAdminClient|@\/lib\/supabase\/admin/.test(registry),
    false,
  );

  const contract = readFileSync(new URL('../src/lib/mobile-api/contract.ts', import.meta.url), 'utf8');
  const publicList = contract.slice(contract.indexOf('export const PUBLIC_ACTIONS'));
  const publicNames = [...publicList.slice(0, publicList.indexOf(']')).matchAll(/'(\w+)'/g)].map((m) => m[1]);
  is(
    'signed-out actions are exactly the four the website allows signed out',
    publicNames.sort(),
    ['recordJobView', 'reportAuthOutcome', 'requestPasswordReset', 'resendConfirmation'],
  );
}

console.log('\n— a mobile route never builds the cookie client');
{
  const server = readFileSync(new URL('../src/lib/supabase/server.ts', import.meta.url), 'utf8');
  const scopeCheck = server.indexOf('mobileScope()');
  const cookieRead = server.indexOf('await cookies()');
  is('createClient asks for the mobile scope first', scopeCheck > -1 && scopeCheck < cookieRead, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
