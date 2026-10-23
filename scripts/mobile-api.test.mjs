/**
 * The mobile API's door rules that can be checked without a server.
 *
 *   node --experimental-strip-types scripts/mobile-api.test.mjs
 *
 * readBearer() decides whether a request carries something worth asking the
 * auth server about. adminDoor() decides whether an app session may pull an
 * admin lever at all. The registry is checked by its source: which actions the
 * app may reach is a security property, and "only these admin levers, and only
 * behind the admin door" should fail a test the day somebody adds another, not
 * show up in a review. The HTTP behaviour (401s, 404s, 415s, no cookie fallback) is
 * exercised against a running build by scripts/mobile-api.smoke.mjs.
 */
import { readFileSync } from 'node:fs';

const { readBearer, challenge, tokenRefused } = await import('../src/lib/mobile-api/bearer.ts');
const { secondFactorDue, tokenAssurance } = await import('../src/lib/auth/second-factor.ts');
const { adminDoor, assuranceOf } = await import('../src/lib/mobile-api/admin-door.ts');
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

console.log('\n— an admin lever opens only for a session the website\'s console would let in');
{
  const token = (claims) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`;
  const verified = [{ status: 'verified' }];
  is('aal2 is read from the token', assuranceOf(token({ sub: '1', aal: 'aal2' })), 'aal2');
  is('aal1 is aal1', assuranceOf(token({ sub: '1', aal: 'aal1' })), 'aal1');
  is('no claim is the lower level', assuranceOf(token({ sub: '1' })), 'aal1');
  is('an unreadable token is the lower level', assuranceOf('not.a-token'), 'aal1');
  is('code given this session: open', adminDoor({ jwt: token({ aal: 'aal2' }), user: { factors: verified } }, true), 'open');
  is(
    'an authenticator not yet used this session: the challenge first',
    adminDoor({ jwt: token({ aal: 'aal1' }), user: { factors: verified } }, false),
    'mfa_challenge',
  );
  is(
    'no authenticator where one is required: set one up first',
    adminDoor({ jwt: token({ aal: 'aal1' }), user: { factors: [] } }, true),
    'mfa_required',
  );
  is(
    'an unfinished enrolment is not an authenticator',
    adminDoor({ jwt: token({ aal: 'aal1' }), user: { factors: [{ status: 'unverified' }] } }, true),
    'mfa_required',
  );
  is(
    'no authenticator where none is required (the escape hatch): open',
    adminDoor({ jwt: token({ aal: 'aal1' }), user: {} }, false),
    'open',
  );
}

console.log('\n— the app can reach only what the registry lists');
{
  const registry = readFileSync(new URL('../src/lib/mobile-api/registry.ts', import.meta.url), 'utf8');
  const imports = [...registry.matchAll(/from '(@\/lib\/actions\/[\w-]+)'/g)].map((match) => match[1]);
  is('found the action imports', imports.length > 10, true);
  is('never checkout', imports.includes('@/lib/actions/billing'), false);
  is('never the admin client', /createAdminClient|@\/lib\/supabase\/admin/.test(registry), false);

  // Of the admin console, only the levers the app's console has — never
  // taxonomy, email requeues or anything else in those files — and every one
  // of them behind the admin door. Every import statement from either admin
  // file counts: a second `import { … } from '@/lib/actions/admin'` added
  // further down must not slip past this.
  const adminNames = [...registry.matchAll(/import \{([^}]*)\} from '@\/lib\/actions\/(?:admin|moderation)'/g)]
    .flatMap((match) => match[1].split(','))
    .map((name) => name.trim())
    .filter(Boolean)
    .sort();
  is('the admin levers the app has are exactly the console levers its screens offer', adminNames, [
    'addModerationNote',
    'closeDeletionRequest',
    'closeReports',
    'decideAppeal',
    'deleteTaxonomy',
    'endSessions',
    'getDocumentUrl',
    'moderateJob',
    'moderateReports',
    'requeueEmail',
    'revealContact',
    'reviewCompany',
    'saveTaxonomy',
    'setAccountApproval',
    'setAgentRestriction',
    'setCompanySuspension',
    'setJobFeatured',
    'setReportingRestriction',
    'setSignInBlock',
    'setUserRole',
  ]);
  // Every use of an admin lever's name, outside its import and the comments,
  // is its registry entry — and that entry wraps it in forAdmins(...).
  const code = registry.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && !/^\s*(import |\} from |  [a-zA-Z]+,$)/.test(line));
  for (const name of adminNames) {
    const uses = code.filter((line) => new RegExp(`\\b${name}\\b`).test(line));
    is(
      `${name} runs only behind the admin door`,
      uses.length === 1 && new RegExp(`^\\s*${name}: \\{ run: forAdmins\\(`).test(uses[0]),
      true,
    );
  }
  const contract = readFileSync(new URL('../src/lib/mobile-api/contract.ts', import.meta.url), 'utf8');
  const adminList = contract.slice(contract.indexOf('export const ADMIN_ACTIONS'));
  is(
    'the contract names the same levers',
    [...adminList.slice(0, adminList.indexOf(']')).matchAll(/'(\w+)'/g)].map((m) => m[1]).sort(),
    adminNames,
  );
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

console.log('\n— a password alone is not the account when it has an authenticator');
{
  const token = (claims) =>
    `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`;
  const aal1 = token({ sub: '1', aal: 'aal1' });
  const aal2 = token({ sub: '1', aal: 'aal2' });
  const verified = { factors: [{ status: 'verified' }] };
  const unverified = { factors: [{ status: 'unverified' }] };

  is('the claim is read', tokenAssurance(aal2), 'aal2');
  is('no claim is none', tokenAssurance(token({ sub: '1' })), null);
  is('garbage is none', tokenAssurance('a.%%%.c'), null);
  is('nothing is none', tokenAssurance(undefined), null);
  is('a claim that is not a word is none', tokenAssurance(token({ aal: 2 })), null);

  is('factor, aal1: owes the code', secondFactorDue(verified, aal1), true);
  is('factor, aal2: answered', secondFactorDue(verified, aal2), false);
  is('factor, a token that states nothing: owes it', secondFactorDue(verified, token({ sub: '1' })), true);
  is('factor, no token at all: owes it', secondFactorDue(verified, null), true);
  is('no factor, aal1: nothing owed', secondFactorDue({ factors: [] }, aal1), false);
  is('a setup never finished is no factor', secondFactorDue(unverified, aal1), false);
  is('no factor list is no factor', secondFactorDue({}, aal1), false);
  is('nobody owes nothing', secondFactorDue(null, aal1), false);

  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const http = read('../src/lib/mobile-api/http.ts');
  is('the door judges every token it accepts', /secondFactorDue: secondFactorDue\(data\.user, jwt\)/.test(http), true);
  is('a route that needs somebody refuses it', /if \(factorDue && !options\.optional\) return secondFactorRequired\(\)/.test(http), true);
  is('a signed-out-welcome route runs it signed out', /session = factorDue \? null : verified\.session/.test(http), true);
  is('the shared routes refuse it, by token and by cookie', (http.match(/return secondFactorRequired\(\)/g) ?? []).length >= 3, true);

  const actions = read('../src/app/api/mobile/v1/actions/[name]/route.ts');
  is('the actions door says why it refused', /refusedForSecondFactor\(\) \? secondFactorRequired\(\)/.test(actions), true);

  const middleware = read('../src/lib/supabase/middleware.ts');
  is(
    "the website's pages judge the server's user, not the cookie's copy",
    /isSecondFactorDue\(user, /.test(middleware) && !/getAuthenticatorAssuranceLevel\(\)/.test(middleware),
    true,
  );

  const account = read('../src/lib/actions/account.ts');
  const deletion = account.slice(account.indexOf('export async function deleteMyAccount'));
  is(
    'deleting an account asks first, before anything is removed',
    deletion.indexOf('sessionOwesSecondFactor(') > -1 && deletion.indexOf('sessionOwesSecondFactor(') < deletion.indexOf('deleteUser('),
    true,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
